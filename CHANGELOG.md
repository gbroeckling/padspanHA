# Changelog

All notable changes to PadSpan HA are documented here.

---

## 0.38.239 — Lights as buttons: each button under its light (2026-11-13)

### Changed
- **⋯ → "Lights as buttons": a light's button now sits on the floor straight under the light, with a dotted line up to the light itself and a dot on it.** In 0.38.237 the button sat on the fixture. With the ceiling cut away, a ceiling light's button then hung in the air and showed over another room, so it was not clear where the light was. On the floor, a button is in its room and at its spot, and the line shows which fixture it switches. A button for several lights has a line to each of them.

---

## 0.38.238 — Move a light in the 3D editor (2026-11-13)

### Added
- **Mapping → Atlas builder → 3D look → Edit → Heights → "Move it".** A light, a sensor or a readout could have its height and its kind ("What is this?") set in the 3D look, but its place only on the flat map. Now: tap the device, press **Move it**, then tap its new place on the same floor.
  - The move is written to the device's place on the map at once. It is not part of the editor's Save, Undo or Discard; **Put it back** undoes the last move.
  - Its height and everything else about it stay as they are.
  - A tap on another floor is refused, with where a device changes floor (the flat map).
- **The Heights sheet says when a light is drawn away from where it is placed.** A strip, a sconce and a few other kinds are drawn on the nearest wall or round their room; when that is more than half a metre from the spot, the sheet says how far, and that "What is this?" changes it.

---

## 0.38.237 — Lights as buttons in the 3D look (2026-11-13)

### Added
- **⋯ → "Lights as buttons" (the 3D look on the Atlas tab and its wall screens; off until you tick it).** In the 3D look a light that is off is drawn its real size, which from across a room is a few pixels, and a tap meant for it could land on the sensor beside it. With this ticked:
  - **Every light on the floors showing is a round button of one size**, standing on the light and drawn over the walls: gold when it is on, dark when it is off. The button is what a tap lands on, so what you see is what you hit. A hold still opens the light's controls, and a hold then a drag still dims it.
  - **Buttons that would overlap become one, with their count.** A tap on it lists those lights, each with its own switch, with "All on" and "All off".
  - **A tap anywhere else in a room opens that room's sheet**: its lights and other devices, with all lights on or off. A sensor, a temperature chip or a lock under the finger opens its room too, instead of answering the tap itself; holding it still opens it. While a class chip (Motion, Temps, …) is picked, that class answers taps as before.
  - A light on a floor hidden under another floor has no button and takes no tap.
  - Double-tap to fly to a room is not available while this is ticked: the first tap opens the room's sheet.
- Each screen keeps its own tick, as for the rest of the ⋯ list. Nothing changes on a screen that leaves it unticked.
- The opt-in usage report counts the tick, and taps on a button, on a button for several lights and on a room. Counts only, never a name.

---

## 0.38.236 — Taps on lights in the 3D look; Small fixes after the set-up round (2026-11-12)

### Fixed
- **A tap on something the device filter has dimmed now says why nothing happened.** With one of the ☰ chips picked (Lights, Motion, Temps and so on), everything else is dimmed and takes no taps. In the Atlas's 3D look that was silent: a wall left on Motion looked as if its lights were broken. A tap on a dimmed device now shows "Only Motion takes taps now: the rest is dimmed." with a **Show all** button that puts the filter back to All.
- **A tap with a finger switches the light in the 3D look even if the finger rolls a little.** If it moved more than 8 pixels (about 3 mm on a wall screen) the tap was treated as the start of a turn of the house and did nothing. A finger may now move up to 16 pixels and still count as a tap. A mouse is unchanged, and so is the flat Map.
- **On a phone, the "Save the scale" bar no longer lies over the plan.** On the one-length scale screen the bar was held at the bottom of the screen, over the lower part of the picture where the two ends are tapped. On a narrow screen it now comes after the length, as an ordinary row.
- **The Rooms page's "Put it on the map" shows that it is working.** The button reads "Putting it on the map…" and can't be pressed twice while it writes.
- **The Atlas header's tip follows ⋯ "Tap a light to switch it" at once.** It used to keep the old words until the page was next drawn.
- **Escape closes a tag's, person's or receiver's card in the 3D look**, as ✕ does.
- **The Atlas builder's guide opens by itself once.** If it was left open and never closed, it came back on every visit. "Guide me" still opens it.
- **Wording.** The guided tour's Overview picture and its troubleshooting line say "Receivers", as the screens do. A calibration point heard by one receiver reads "(1 receiver)".

---

## 0.38.234 — Tapping lights in Live Aboard; ⋯ on the flat Map; Covered patios, open decks and the Outside floor; Grey paving tiles for patios and decks; Plans tool: plain words and a way on; Let Claude draw your rooms: your changes kept, every floor reachable; Let Claude draw your rooms: simpler, and it says what it does; Setting up in order: each step leads to the next; Set the scale right after an upload; feet and inches (2026-11-11)

### New
- **⋯ on the flat Map too.** The Atlas's flat Map (the sidebar and wall screens) has the same ⋯ "Show on this screen" list as Live Aboard, at the foot of the controls rail on the left, with the lines that change the flat Map: Tap a light to switch it, Scene row, and Other floors, faded. It works with Live Aboard turned off, and a tick made in either look applies to that screen's other look. The controls rail is part of PadSpan Pro, as Live Aboard is, so on a free install there is no ⋯ on the flat Map and these lines can't be changed per screen there.
- **Tap a light to switch it**, a new line in ⋯. It is on, as before: a tap on a light switches it on the flat Map and in Live Aboard. Untick it on a screen (a wall in a busy room, say) and a tap on a light switches nothing there, in either look; holding a light still opens its brightness and colour. The Atlas's header tip says so on that screen. Mapping is unchanged.
- **Say what kind of space a room is.** On the Rooms page, each room on a floor of the house has a Kind of space choice: Indoors, Open deck or patio (open to the sky), or Covered patio or porch (a roof, deck or floor over it, open sides). Left on "Work it out", PadSpan reads the name as before (deck, patio, porch...) and shows what it worked out. In the 3D view a covered patio stays dry in the rain and snow wherever something is over it (a part reaching out past the deck still gets wet), and a ceiling light there hangs from what covers it instead of being set into the floor; you can still tap it where its spot on the patio floor shows past the deck's edge, and while it is off a small ring marks that spot. A porch you mark Covered with nothing above it gets a thin roof of its own, and its lights hang from that roof.
- **A deck or patio belongs to the floor it is level with.** The Outside floor is for what is on no level of the house, such as a shed, a driveway or a garden. A deck or patio put on the Outside floor gets a short reminder on the Rooms page; nothing is moved.
- **Grey paving tiles for an outdoor space.** On the Rooms page, a deck, a patio or a room on an outdoor floor now has a Surface choice: Standard, or "Grey paving tiles (2 ft × 2 ft)". With tiles chosen, the 3D view draws that space's floor as grey 2 ft square pavers with thin joints, true to scale, square to the room and clipped to its shape (rain and snow fall on it as before), and the flat map fills it with the same tiles. Every room keeps the floor it had until you choose otherwise. It is only a drawing: positioning never reads it.
- **"Set this plan's scale now", right after you upload a floor plan.** PadSpan needs a plan's real size before rooms, receivers or anything in metres can go on it, and many houses stopped at a plan with no scale. Now, straight after Mapping → Upload, the plan opens on one short step: click (or tap) both ends of something you know the length of, such as a wall or a doorway, and type its length (4.2 m, 420 cm or 13' 9" all work). You can zoom in, and drag an end to move it. A second length running the other way is optional: it checks that the picture isn't stretched, and says so plainly when the two don't agree. Save keeps the scale exactly as Mapping → Edit → Measure does; Later puts it off. Either way it is asked only once per plan. It uses no AI and needs no Pro.
- **Feet and inches, if you want them.** Settings → Appearance → Units has a new switch, "Show lengths in feet and inches", off unless you turn it on. With it on, the places where you measure or check a floor plan show feet and inches, and room sizes in square feet: the new scale step, Mapping → Edit → Measure, the Setup Wizard's scale step, the plan sizes in the Library, and the room helper's measuring screen, room list and "scale may be off" notice. A number typed without a unit is then read as feet; "4.2 m" still means metres. Everything is still stored in metres, so nothing you saved changes, and other screens stay in metres.
- **"No scale yet: Measure".** A floor plan with no scale now has one quiet line with a Measure button in Mapping → Library and under Setup's "Set the scale" step. Nothing pops up.

### Changed
- **A patio under a deck or a room above is now taken as covered.** In the 3D view, rain and snow no longer fall on the part under the floor above (the deck above is rained on as before), and pots, pendants and fans there hang from it. To have it drawn open again, choose "Open deck or patio" for that room on the Rooms page. Positioning, presence and calibration are unchanged: a covered patio is still outdoors for them.
- **Rooms from plans on a floor whose plans have no scale yet** now says so ("The plans on this floor have no scale yet, so their rooms can't be read.") and offers **Measure** for that plan, which opens it in Mapping → Edit with the Measure tool. It no longer sends you to 3D Stack, which can't place a plan in a house with nothing measured. Where Let Claude draw your rooms is offered for your house, a line under it offers that too. On a wall screen nothing opens another page: the line says where to do it from another screen.
- **Line up plans** lists a floor whose plans have no scale yet with its real count ("2 plans, none with a scale yet") and the same Measure button, instead of "0 plans". When no plan in the house is measured yet, the tab shows one message (Line up needs one plan measured first) instead of a list of floors it can't use.
- **No Line up or Rooms tab?** A short line under the Plans tool's tabs says they exist and what turns them on: Settings → AI → Build from plans, with Claude Opus 5.5 or newer through Home Assistant's Anthropic integration. It has a button to Settings → AI.
- **Settings → AI:** with "AI map-building research" on and an AI Task that can't run Build from plans, a muted line now says why (no AI Task chosen, not Claude through the Anthropic integration, an older Claude model, or a model PadSpan can't tell), using the same words as the Connect Claude screen, with a link to the guide. Nothing changes with the research switch off.
- **Mapping → 3D Stack:** a Reference plan with no scale yet now says "has no scale yet, so nothing can be lined up to it" under the buttons, with a Measure it button. The Mapping wizard's scale step adds that the AI tools that read your plans need the scale too.
- **Plainer words in Line up plans and Rooms from plans.** "Anchor" is now "the plan the others are lined up to", a refile is "move to another floor", the measured plan is "the plan that set your house's scale", and match scores read "well", "roughly" or "poorly" (the number is in the hover). The held-out check is "a second check against your calibration spots". Stop messages point to Mapping → 3D Stack → Alignment Overlay, which is where lining up by hand really is.
- **Add data via plans** with no measured plan yet says to measure one in Mapping → Edit → Measure, as the other two tabs do.
- The Plans tool and the Settings line show only with the experimental AI switches on. The 3D Stack line, the wizard's sentence and the reworded 3D Stack messages are for everyone. What gets saved hasn't changed: only the words and the next step did.
- **Undoing the helper's rooms in Settings → AI also takes back the plan's scale it set**, as the Undo on its last screen does. The row says so before you confirm, and the plan will need measuring again. If you measured that plan again yourself in Mapping → Edit → Measure, the scale is yours and stays, and nothing is said about it. If something placed in metres was added or changed since (rooms, walls, zones, receivers, calibration points, the 3D house), the scale stays, the rooms are still taken back, and the row says so before and after. This undo also counts as the helper's Undo: the Overview won't suggest the helper again.
- **Claude's reading of a plan's measurement isn't paid for twice.** Pressing "Read my plan" again for the same plan and picture shows the reading Claude already made ("Claude already read this plan's measurement") instead of reading it again. "Ask Claude again", on that screen too, asks for a new reading and says it is charged.
- **A floor that already has rooms isn't read again by the helper.** It is listed apart as "Already has rooms", so the helper can't add a second set of rooms on top. Change those rooms in Mapping. A plan with no floor counts as having rooms only when rooms were drawn on it. With one plan left, the helper names the plan it will read.
- **"Choose another plan"** on every step of the helper goes back to the plan chooser; what Claude read stays kept for its plan. If the plan you were working on was deleted, the helper says so and opens on the chooser.
- **One button starts it, with nothing to tick.** The first screen says what will happen, how many times Claude reads your plan (Anthropic charges your Anthropic account for each read), what is sent, and that nothing is saved until you press Save. "Draw my rooms" is the go-ahead. You no longer turn on "AI map-building research" or "Build from plans" in Settings → AI for it, and using it doesn't turn them on (the Plans tool in Live Aboard stays as you had it). When Home Assistant has a suitable Claude that isn't PadSpan's AI yet, the first screen says Start will choose it and keep your earlier AI Task as the backup.
- **The scale: you measure first, and Claude is optional.** A plan with no scale opens straight on one screen: click both ends of something you know the length of and type it. Claude no longer reads the plan for a printed measurement on its own, so nothing is paid for before it helps. "Ask Claude to look" is there if you want it, with its cost said. When Claude has a reading it could double-check (across and down agree), it appears as one line with "Use it", which puts its two ends and its length on the plan for you to check, with a close-up of the print. A reading it couldn't double-check is never offered. If your own line and Claude's reading are far apart, the screen says so. The size shown is now said to be the whole picture's, margins and all.
- **Setup and the Mapping wizard offer it when you need it, not after a week.** Once you have opened the Set the scale or Draw the rooms step and left it unfinished, those two places show the helper's line, however new your plan is. The Overview card still waits a week, as before.
- **Connecting Claude says what it really takes.** The screen now says up front that you need an Anthropic account with credit on it and Home Assistant's Anthropic integration, about ten steps and around 15 minutes, once, and lists every step from signing up to coming back. If Home Assistant already has the Anthropic integration, the steps that make it are skipped. When you come back to the page, it checks again by itself. The guide "Connect Claude for PadSpan" on padspan.traks.ca now counts the same steps.
- **An account with no credit is found before you do any work.** When you press "Draw my rooms", PadSpan checks your Anthropic account with one tiny read with no plan in it (once an hour at most). If Anthropic says the account is out of credit, you're told then, not after measuring your plan.
- **Free installs: the trial comes after Claude is connected**, and it says what it's for here: drawing your rooms. The rooms you save stay when the trial ends.
- **The rooms list puts what needs a look last, under its own heading,** after the rooms that look right. Each room shows its size in m², so a scale that is off shows itself (a 24 m² bathroom). Each row keeps to its tick, name, size and a short note; "Also make it a Home Assistant area" (still off, room by room) and Claude's look again sit behind the row's ⋯. Save stays in view at the bottom of the screen while you scroll the list, on a computer and on a phone.
- **"The scale may be off" when the evidence says so.** When at least two signs Claude's reading of your rooms already gives agree (room sizes for their names, the rooms' overall size, a printed measurement Claude already read and double-checked), the list says so with the example in plain words. "Check the scale" opens the measuring screen; after Save the same rooms come back at the new scale, worked out from the same reading with no new read (their names and ticks start again from Claude's, and the list says so). "The scale is right" hides it for that plan. It never changes anything by itself and never stops you saving. If things in metres already sit on the scale, it says what a new measurement moves and takes you to Mapping → Edit → Measure.
- **When Claude finds no rooms**, the main choice is drawing them yourself (or another plan); reading the same plan again is the lesser one, and says it usually finds the same and costs two more reads.
- **Taking the helper's rooms back later is where you'd look.** "Undo the rooms Claude drew" is now on Setup's Draw the rooms step, and in Settings → AI under "Let Claude draw your rooms" itself (no longer inside "Build from plans", and shown whatever the research switches). It says what it takes back, asks once, and does the same as the Done screen's Undo: the rooms, then the plan's scale if the helper set it (warned first; a scale you measured again yourself stays, with no warning; a scale that things in metres now sit on stays, and says why).
- **After an Undo, the helper offers what to do next**: try again, or draw the rooms yourself.
- **New: "Put my receivers in their rooms"**, for everyone, on Setup's receivers step and on the helper's last screen. No AI and nothing to pay: each Bluetooth receiver whose Home Assistant area is one of your rooms with an outline, and that isn't on the map yet, goes to the middle of that room, ready for you to drag to where it is mounted (Mapping → Edit → Radios). A receiver already on the map is never moved. It says how many it placed and which it couldn't, and why (no Home Assistant area, or its room has no outline yet). A backup is taken first, and one Undo takes them back off the map (one you moved since stays where you put it).
- **The help for "Let Claude draw your rooms"** (and its German, French and Dutch) says all of the above.
- **Plainer words.** The first screen no longer promises that Claude reads a printed measurement for you, or mentions a paid look again at a room you won't see here. The scale is called the scale throughout.
- **One order, everywhere.** Setup, the Overview's Getting started and the Setup Wizard now list the same steps, with the same names and numbers: upload a floor plan, set the scale, draw the rooms, floor heights, place the receivers, calibrate. Floor heights now come after the rooms, and only a house with two floors or more is asked for them (an Outside plan isn't a floor). Until you set them, PadSpan uses an ordinary storey height, so nothing earlier needs them. The Setup Wizard has a floor-heights step for those houses too. All three count the same steps and mark the same one as next: the first one not done (skipped ones last). Getting started shows "See someone on the map" after the steps, as what comes next, without counting it, and the Setup Wizard's step buttons show a ✓ on the steps that are done.
- **Setup is in the menu** at the top, beside Mapping, from a new install on, until every step is done or you choose Skip setup. Then it leaves the menu; Getting started and Mapping's Setup button still open it. After Skip setup, the Overview keeps one quiet line where Getting started was, "Set-up: n of m done · Open Setup", until every step is done (✕ hides it in that browser). Setup's bar over a tool names the step of the tool you pick in Mapping → Edit.
- **A plan's first scale is always the simple screen**: click both ends of something you know the length of and type it. That's now true from Setup, the Setup Wizard (Basic and Advanced), Getting started, every "No scale yet: Measure" and right after any upload, not only after an upload in Advanced. Mapping → Edit → Measure is still there for measuring a plan again.
- **Saving leads on.** Saving floor heights says what comes next, with a button to it. After you save a plan's first scale you go straight to drawing its rooms, with a line saying the scale is set. Mapping → Edit says what the plan needs next (the rooms, floor heights, the receivers, then calibrating), with one button to it, and never moves you on while you may still be drawing. The Setup Wizard's Next buttons say where they go. Edit's tools are in the order you need them (Measure, Rooms, Receivers, Signal walls), and a plan with no rooms opens on Rooms.
- **"Put my receivers in their rooms" is where you place receivers** too: on Edit's Receivers tool and the Setup Wizard's receivers step, as well as Setup.
- **Rooms you drew yourself count right away** for "Put my receivers in their rooms", as soon as the plan has a scale; you no longer have to finish the Setup Wizard first. A room drawn on a plan with no scale is said, with a button to set that plan's scale.
- **"Receivers" throughout setup** (it said "scanners" or "radios" in some places): Mapping, Edit's Receivers tool (it was Radios), Calibration and Beacon Tune, the Overview's "Who's where now" and Basic's Receivers count. Calibration's first step is now "Check receiver positions".
- **Getting started's "Or let Claude draw the rooms"** now shows once you've opened the scale or rooms step and left it unfinished, as Setup's line does, instead of after a week. If you told the Overview card "Don't ask again", it stays away.
- **Mapping's Atlas tab is now called "Atlas builder"**, so it isn't mixed up with the Atlas in Home Assistant's sidebar.
- **Basic mode, and uploads in the Setup Wizard,** go straight on to the wizard's own "Set the scale" step after an upload, instead of back to the Library.

### Fixed
- **Live Aboard: a tap on a light you can see switches it.** A light whose nearest point was hidden behind a wall, a light on a wall that is cut away (its glow on the floor is what shows, and now takes the tap), and a light under a code chip or a room name used to miss. On the Atlas tab and its walls a light now beats a code chip or a room name within its reach; everything else answers as before, the nearest under your finger: a press right on a person or a tag, a motion marker, a leak, smoke or gas alarm, a lock or a linked piece of furniture goes to that, and a fan beats nothing it didn't before. Where lights on two floors line up on screen, the chosen floor's (or the front one) wins. With Tap a light to switch it unticked, a tap goes to whatever is under the light (a door, a room name); holding the light still opens its controls.
- **Live Aboard: a tap that switched a light shows it**, with a ring that opens out once from the light, so it is seen even when the light is far off; only once Home Assistant switched it.
- **Live Aboard: Vacation Mode's banner and the Find toast no longer catch taps meant for the house** over the 3D view; only their buttons and slider do.
- With the usage report on, PadSpan counts a light switched by a tap in Live Aboard and one that couldn't be (`house3d_show:light_tap:ok`, `:failed`), a screen unticking or ticking Tap a light to switch it, and ⋯ opened on the flat Map (`house3d_show:opened:flat`). Counts only, never a name.
- **Your changes on the rooms list are kept.** Names you type (a moment after you stop typing), rooms you untick and "Also add this room to Home Assistant" are kept with that reading of your plan. Pressing Back, opening the helper again or reloading the page brings the list back as you left it. Saving, undoing or asking Claude for a new reading starts afresh. Clearing a name gives Claude's name back. Save and "Join into one" wait for a name still being kept, and one press saves once.
- **A second floor can always be reached.** Once the helper has saved rooms on one floor, Setup, the Mapping wizard and the Plans tool keep offering it while another floor with a plan has no rooms yet. The same goes for a reading or measurement left part-way. Setup and the Plans tool both say "Carry on", with words that say where you were, and Carry on opens where you left off: the measurement you were making, or the plan chooser. Once every floor with a plan has rooms, however they got there, it stops. The Overview still doesn't bring it up for a house with rooms, and a house that got its rooms another way is never offered it. Plans on floors named Outside, Yard or Garden count as outdoors here, as everywhere else in PadSpan.
- **"Place receivers" opens the plan you just saved**, not another floor's plan.
- **Setup keeps the helper's line** under "Draw the rooms" when its next step moves on (for example to floor heights in a house with two floors). On a step already done, it no longer starts with "Stuck?".
- **After the helper's Undo you can try again** from Setup, the Mapping wizard or the Plans tool. The Overview still won't suggest it again.
- **After an undo in Settings → AI**, opening the helper again starts where you choose the plan, not on the old rooms list.
- **The measurement Claude quotes matches the plan.** When the length on your plan is a row of shorter lengths, the scale check shows all of them (or how many there are, if they're too many to show), never just the first few beside the whole length. A length printed as 66-7 or 2029 is shown as printed.
- **The close-up of the printed measurement fits the screen** and shows the whole measurement Claude quoted. For a measurement running down the plan, the numbers printed beside the line are shown whole. A line under it says when you can scroll for the rest, and it stays where you scrolled it. The answer buttons stay in view.
- **Yes only answers.** On the scale check, "Yes, that's right" and "No" choose your answer. The one button below saves the scale and then has Claude read the plan for its rooms, and says so.
- **Measuring by hand is easier.** The plan gets more of the screen, and + and − zoom it so the printed numbers can be read. Zoomed in, drag the plan to move around it. Phones say "Tap", and two fingers pinch to zoom without moving the end you touched.
- **Settings → AI says what the AI tools can save.** The automatic backups name the helper as the helper.
- **Smaller fixes:** room names on the small plan picture no longer run into each other, and a room too small for a readable name is named only in the list. A plan named like its floor is named once. The phone's title bar says "Claude draws rooms" instead of cutting the name off. A room called "Hall 2" because another room is already "Hall" says so. "Click two rooms to join them" says Click with a mouse and Tap on a touch screen.
- **Save works on the first press** when you press it straight from a room's name field. Leaving the field used to redraw the list under your finger, so the press was lost; the same went for the ticks and "Join into one".
- **The close-up of a measurement running down the plan shows the whole line**, so every number Claude quoted can be scrolled to.
- **When the plan you were working on was deleted**, the helper says so at the top, in words for the plans that are left, and Setup no longer says you started measuring it.
- **The Setup Wizard's Finish** counts rooms drawn on the house for that floor (the rooms helper's), not only those traced on the plan, and its next step is the first one not done (floor heights before calibrating, on a house of two floors or more). The drawing tool's button is now "Finish outline", so it isn't mixed up with the wizard's Finish. Edit → Measure's Save Scale shows the new size at once.
- **Feet and inches, said right.** With feet on, a length typed in metres says what it was read as ("= 13' 9" (read as metres)"), and one typed in feet with them off does too. The scale step says the map is "to scale", not "in metres". In the Setup Wizard's scale step, saving the scale is the main button; Next comes once a scale is saved (Skip is still there).
- **The Rooms page said "Not drawn" for a room you had drawn on a floor plan** until the Setup Wizard's last screen. A room drawn on a plan that has a scale now reads as drawn everywhere (the Rooms page and the Setup Wizard's count agree); if it isn't on the map of your house yet, the Rooms page says "Drawn on <plan>, not on the house map yet" with a **Put it on the map** button for that room. It only adds a room your house doesn't have; nothing already on the map changes, and nothing is put there without you pressing it.
- **After "Put my receivers in their rooms", every list agrees.** The Setup Wizard's receivers step said none were placed and Getting started still showed the step as not done; now a receiver counts as placed whether it is pinned on a plan or placed on the map of your house. The message after the button now says where to drag them (Calibration's first step) and where to set their heights (there, or on the Receivers page).
- **Basic mode no longer points to screens it doesn't have** (Mapping → Edit → Measure, Settings → AI). It names Setup's steps instead, and says plainly where rooms Claude drew can be reshaped (Advanced mode's Mapping → Layout) or taken back.

### Fixed (after the review and a run on a real house)
- **"The scale may be off" says so only on real evidence.** With a printed measurement Claude read and double-checked that disagrees with your scale, and room sizes off the same way, it says so with the reading's factor. Without one, it speaks only when the rooms are impossible sizes for what they are, the kind of thing a unit mix-up does (feet typed as metres, or the other way round): "the rooms come out several times too big". It never speaks for an unusual home whose scale is right (a studio, a garage and workshop, an attic of store rooms), and it never goes on two rooms. The size on each row is there for anything subtler. Room names in German, French and Dutch count too.
- **"Check the scale" never costs a right scale.** Your scale stays in place while you measure again; it is replaced only when you save a new measurement that differs, in one step. Leaving the screen without saving changes nothing. If the rooms list it belonged to is gone, the screen says what Save really does and nothing is read without your say-so.
- **"Check the scale", finished off.** "Ask Claude to look" on that screen reads only the printed measurement, never the rooms again, and a reading Claude already made is offered as "Use it" there too. "Back to my rooms" ends the check without measuring and takes you back to the same list, names and ticks kept; the notice stays on the list until you press its own "The scale is right", and Setup no longer says you are measuring. A new scale keeps the plan on the floor you chose for it; if saving it goes wrong in any way, the plan is put back exactly as it was, unless you measured it in Mapping meanwhile, in which case your measurement stays and you're told. If the check can't be looked up for a moment, you're told and it stays for later.
- **"The scale may be off" stays quiet on big rooms at their right size** (an estate wing, a warehouse unit, a church hall, a barn, a gym): without a printed measurement it needs ordinary rooms like a bathroom, a hall or a closet to be absurd sizes too, which is what a unit mix-up does.
- **"The scale may be off" now catches a plan read far too small.** Rooms that are impossibly small (a 1.3 m² kitchen, a 3 m² bedroom) are strong evidence on their own, so it says so when most rooms are smaller than any such room can be. Rooms that are very large still need the strict test, because ballrooms and warehouses exist. A small home of only a few rooms (a cabin, a studio) needs more evidence, so it stays quiet at its right size. The example it gives is a room it can name, said plainly: "Kitchen would be 1.3 m²: too small for any kitchen".
- **A refused Save always says why**, even after the list is refreshed. A list whose plan you measured again in Mapping is drawn again at the new scale when you come back to it (no new read), so Save works.
- **"Put my receivers in their rooms"**: Setup's line also shows for rooms you drew by hand.
- **"The scale may be off": at the right scale it says nothing.** That now holds for many more homes: floors of storage lockers, capsules or cellar compartments, tiny flats in Hong Kong and Tokyo, a narrowboat, a caravan, a tiny house, student rooms, a block of micro-apartments and an old terrace house. Rooms PadSpan can't put a name to never count as too small. An ordinary home with one bathroom and no hall now gets the notice when feet were typed as metres (a 290 m² living room, a 54 m² bathroom); a large ensuite on its own never sets it off.
- **A refused Save says why in the Save bar**, where you pressed it, not at the far end of the list. If your list was drawn again where the plan is now, it says so and offers "Save again"; reading the plan again is the lesser choice and says it costs two more reads.
- **Every button that has Claude read your plan says what it costs, right beside it**: Try again, Carry on, Find the rooms, doing the next floor, Save and find the rooms, and a room's "Ask Claude to look again".
- **On a phone, the first tap on a button straight from a room's name field works** ("Check the scale", Save and the rest); it used to be lost and needed a second tap.
- **The measuring screen keeps Save in view** at the bottom of the screen, as the rooms list does (on a phone it was below the fold).
- **A new scale from "Check the scale" is safe from a power cut part-way:** at the next start it is finished, or your old scale is put back. If you measure the plan in Mapping at the same moment, your measurement stays and you're told.
- **A list drawn again after the plan was lined up says "Drawn again where the plan is now"** (it said "at the new scale" even when the scale hadn't changed). The helper also does less work while it waits for Claude.
- **A list of rooms Claude already read whose plan was measured again or lined up since** is drawn again at the scale now, from the same reading, and says so; it is never shown with old sizes.
- **Rooms Claude already read are never paid for twice.** Opening the helper again on a plan whose rooms were read and not saved shows that list ("Claude already read this plan's rooms"), with reading again as the paid lesser choice.
- **Setup is up to date after Save and Undo** (it said "no rooms" until a reload).
- **Setup and the Mapping wizard offer the helper when you have actually left the Scale or Rooms step unfinished**, not on first opening it.
- **Put my receivers in their rooms:** Setup's count and its reasons now come from the same rule the press uses, so it never offers a press that places nothing; when nothing can be placed it says why. Its Undo takes back the last press (and says how many). The opt-in report of a set-up house that only used this button, or only opened Setup's steps, is unchanged.
- **"Check the scale" belongs to its plan and its rooms.** Leaving part-way and pressing Carry on goes back to measuring that plan, and Save draws the same rooms again with no new read. Choosing another plan meanwhile no longer carries it over, and the plan you left keeps it waiting for you. The rooms are only drawn again when you checked the scale, and the list says so only when they were; if nothing really changed, your names and ticks stay. If drawing them again fails, your list stays exactly as it was. Its Save says that nothing is read again.
- **Put my receivers in their rooms:** a receiver now goes to a point inside its room, even an L- or U-shaped one; only Bluetooth receivers PadSpan actually hears are placed (not other devices that have an area); a receiver already on a plan under an older record is never moved; the Undo survives a reload, takes a backup first, and leaves a receiver whose place, height or floor you changed since. With no receiver ready yet, Setup's receivers step says the button will be there once receivers have areas.
- **Smaller:** the first screen mentions the small account check; a passed check counts only for the AI Task that passed it; opening a finished Scale step no longer counts as being stuck; "coming back later" means coming back to the page, not only reloading the browser, for Setup and the Mapping wizard alike; the Done screen's Undo stays quiet about a scale you measured again yourself; letting go of the mouse outside the helper no longer holds back the list; Save's bar is one compact line on a phone; Setup says where to try again or draw the rooms yourself after an undo; a house that used the helper or the Plans tool before still gets Setup's line when it is stuck again.

---

## 0.38.233 — Let Claude draw your rooms (experimental); Let Claude draw your rooms: the plan's size, read off the plan; The Atlas's scroll bars step aside (2026-11-11)

### New
- **Let Claude draw your rooms (experimental).** For a home that added a floor plan, set its scale, and still has no rooms a week later. Claude reads the plan twice, finds the rooms and their names, and draws them over your plan picture. You tick the rooms to keep, rename or join any, and press Save. A backup is taken first, and one Undo takes it all back. Nothing changes for a home that already has rooms.
- **Where it shows:** a line under "Draw Rooms" in the Overview's Getting started card, or a card of its own on the Overview, with "Not now" (a week, then a month) and "Don't ask again". There is also a line in Setup and in the Mapping wizard's scale and rooms steps. Only administrators see it, never on a wall screen.
- **Names:** a room whose printed name matches one of your Home Assistant rooms on that floor gets that name ("BR 2" finds "Bedroom 2", and so do BEDRM, BED RM, PWDR RM, MBR, FAM RM, UTIL, MECH, W/D, ENS, GAR and others). A size printed with the name (14'-8" x 8'-5", 4.2 x 3.1, 132 sq ft, 12.3 m²) is never part of it. Balconies, terraces, gardens, courtyards, carports and stairs, in English, German, French and Dutch, are offered but start unticked. Any other room is saved in PadSpan only. Tick "Also add this room to Home Assistant" (off unless you tick it) to add it to Home Assistant's areas when you save. Undo takes the room out of PadSpan, but the area stays in Home Assistant, and you remove it on Home Assistant's Areas page.
- **Connecting Claude:** it needs Home Assistant's Anthropic integration and an AI Task using Claude Opus 5.5 or newer. The helper shows the steps, and a new guide covers them in full: [Connect Claude to Home Assistant for PadSpan's room helper](https://padspan.traks.ca/guides/claude-ai-task/). Anthropic charges your own Anthropic account for each read. Only the plan picture is sent.
- **Free installs** can start PadSpan Pro's free trial from the helper. The rooms you save stay when the trial ends.
- **Live Aboard can stay off.** The helper reads and saves rooms only. Doors, windows and stairs Claude found stay in Live Aboard's Plans tool, and that tool still needs Live Aboard turned on.
- **Usage report (if you have it turned on):** where the helper was offered and opened, each step reached and where it was left, how it ended, why a read or a save stopped, whether Claude was ready, the links tapped, and how many rooms were offered and saved. It also says where each saved room's name came from, and whether a Home Assistant area was added. Counts and fixed words only, never a name, a plan, a room or an amount.
- **A plan with no scale can use Let Claude draw your rooms (experimental).** Before, the helper needed a plan whose scale was already set. Now Claude first looks for a measurement printed on your plan (usually under a minute; you can leave the page and come back).
- **Usually you measure one thing yourself first.** When Claude finds a measurement but couldn't double-check it (it read only one direction, or across and down disagree), the helper says so: "Claude found a measurement on your plan but couldn't double-check it, so measure one thing yourself. It's the surest way." Click both ends of something you know the length of (a wall, a doorway, the whole house) and type its length, such as 4.2 m, 420 cm or 13' 9". It shows what it understood ("= 4.19 m", and for a number typed with no unit which one it took: "= 12.00 m (read as metres)", "= 0.45 m (read as millimetres)"). Two taps put the two ends; drag an end, or tap near it, to move it. It works with a finger too. **Show me what Claude read** shows Claude's reading, with no answer picked: "Claude couldn't double-check this one. Look closely at the amber line: it should run the full length the number is for." Save waits until you press Yes or type the number yourself. In a test with real plans, a reading from one direction alone was off by 19 to 41 % on busy scans, and the screen looked right.
- **When Claude read it both across and down and the two agree,** the helper offers that reading with Yes picked: the plan with the measurement drawn in amber between the marks at its ends, a close look at the printed text, and "Claude read **30′-5½″** along the amber line, running across your plan (9.28 m). Is that what the plan says for that line?" Press **Yes, that's right**, or **No, the amber line says:** and type what it says (feet and inches, or metres; the helper shows what it understood), or **Measure something myself instead**. The other direction is shown on a thinner blue line. The footer says how big that makes your plan, and "Save and find the rooms" goes straight on to Claude's rooms read.
- **No measurement printed, or none Claude could read:** the helper asks you to measure one thing, the same way. When Claude's first look didn't match the drawing, **Ask Claude again** takes a fresh look.
- **More printed lengths are read:** fraction characters (30′-5⅜″, 5½″), a decimal comma (12,48 m), chains split by "|", and, only when Claude's own length agrees, feet and inches written as 66-7 and a bare 435 meaning 435 cm. A printed length that PadSpan reads a little apart from Claude's (under 2 %) is still shown, never as double-checked.
- **It is saved exactly as Mapping → Edit → Measure saves a measurement**, through the same code, from the two ends and the length (as Claude read it, or as you typed it): PadSpan works the scale out itself. The house's metre scale is set from it only if your house has none yet. A plan that already has a scale skips this step, and nothing about it changes.
- **Which floor:** asked only when the plan's floor isn't one of your house's floors.
- **Information and a choice, never a stop.** "Across and down disagree by 6 %: the picture may be stretched. The average is used, as Mapping's Measure does." "That makes your plan 412 m across. Is the number right?" You can change the number or save it as it is.
- **Reads:** with no scale yet, about five reads for one plan (up to three to find the printed measurement, two for the rooms). Claude's first look at the plan is kept, so a later Line up plans of the same picture doesn't read it again.
- **Undo** on the last screen takes the rooms back first, then the plan's scale the helper saved, so the plan has no scale again, as long as nothing in metres changed since (a room, a wall, a receiver, a zone, something in 3D, a calibration spot, even one PadSpan records by itself, or another plan's scale). If something was, the scale stays and the helper says so; change it in Mapping → Edit → Measure.

### Changed
- **The helper stops only to keep your data safe.** It won't save a scale for a plan that already has one or has calibration spots, a plan whose picture changed while you were on the screen or since Claude read it, a plan with no size on record, a plan measured in Mapping → Edit → Measure while it was saving, or a plan whose floor it doesn't know; and it saves nothing if the safety backup can't be made. A plan with calibration spots or no size on record is said before Claude reads anything. A backup of your map, plans and calibration is taken before each save and each undo (the last six kept). A save cut short by a restart is finished or taken back the next time the helper starts.
- **If Claude's reading stops** (out of credit, can't be reached, stopped part-way, ten readings a day), the helper says why with the same words and buttons as the rooms read; what was read is kept.
- **Usage report (if you have it turned on):** how a plan's scale was found (a printed measurement Claude read, double-checked or not, none found, measured by you, or set already), what you did with Claude's reading (yes, a corrected number and how far it was from Claude's, measured yourself instead, or looked at a reading that wasn't double-checked), how many directions were read and how far across and down disagreed, how each scale save and undo ended, the scale read's runs and reads (counted apart from Line up plans), and, if you later measure a plan again by hand in Mapping → Edit → Measure, by how much the scale moved (under 1 %, 1–3 %, 3–10 %, over 10 %). Counts and fixed words only, never a plan, a length or a floor.
- **On the sidebar Atlas's flat map, the scroll bars go away after five minutes with nobody touching the page.** They come back at the next touch, key or mouse move, and the map scrolls and pans the same with them hidden. Mapping's map keeps its bars.

---

## 0.38.232 — The usage report counts how setup is going (2026-11-10)

### Changed
- **Nothing on screen changes.** This only adds a few counts to the usage report, for homes that have it turned on. They will help us see where people get stuck between adding a floor plan and having a working map.
- **Homes still setting up:** if you have added a floor plan but not finished setup, the report now says which step comes next (drawing rooms, placing receivers or calibrating) and roughly how old your first plan is, as a band such as "8 to 30 days". Once your home is calibrated, your report is exactly what it was before.
- **Claude, in those same homes:** whether a Claude AI Task in Home Assistant can read your plans, and whether one is set up but not chosen in Settings → AI. You don't need to turn anything on for this to be counted.
- **The Plans tool:** opening it, each tab you pick, picking a floor, and the times it stops before it can start (no plan placed on that floor yet, or its Line up and Rooms tabs not available).
- Counts and fixed words only. Never a name, a plan, a room, a floor, a position, the AI Task or an amount.

---

## 0.38.231 — The stable after 0.38.224: lighting scenes under the Atlas, Show on this screen, a chosen floor fills the screen, how much AI you use, and two experimental plan tools (2026-11-10)

### New
- **This is everything since 0.38.224 in one go,** written as how it works now. The betas' notes under it are steps along the way; where they differ, this one is right.
- **Your lighting scenes as small maps.** A row under the sidebar Atlas's map, under Mapping → Atlas, and in Live Aboard: one small map per scene, for Home Assistant's scenes that set a light you have placed and for Whole house presets that light one floor. Tap one to run it; when all its lights are on, a tap turns them off. Administrators get ✎ and + New scene, which open Home Assistant's own scene editor.
- **⋯ Show on this screen.** A small ⋯ beside Live Aboard's compass, on every screen and on a wall, opens a checklist of everything the 3D house draws: lights, motion, doors and windows, people and tracking, the house, weather and look. Untick a line and it is gone from that screen only. Leak, smoke, CO and gas alarms are always shown. A line your house hasn't set up yet says so, with a button to where it is set up.
- **A chosen floor fills the Atlas.** Choosing a floor on the sidebar Atlas now shows that floor alone, as big as the screen: nearly twice the size on a wall. All shows the stack as before. A leak, smoke, CO or gas alarm on another floor brings the other floors back, faded, with its ring on top, until it clears. To keep the other floors there always, tick **Other floors, faded** in the ⋯ list. Mapping still fades the other floors, since its tools place things by them.
- **How much AI PadSpan uses (experimental).** Settings → AI shows how many reads PadSpan sent to your AI this month. For a Claude AI Task it also shows about what they cost, an estimate that runs a little high. Type your monthly credit to see the share used, and choose a warning at 50, 75 or 90 %. Reads that stopped are listed by why. A house that doesn't use AI sees nothing new.
- **Mapping → Rooms: Merge into one, and add or remove a corner.** Select two or more rooms and Merge into one gives the room you pick one clean outline round them all, asked first and with a safety backup. With one room selected, double-click a corner to remove it, or press the + halfway along a side to add one.
- **Line up plans (experimental, Claude Opus 5.5 or newer).** Off for everyone until you turn on Build from plans in Settings → AI. Claude reads the plans of one floor and PadSpan lines them up to each other. You check each proposal on the 3D view before it is saved; each save takes a backup first and moves only the plan's picture, never calibration points, rooms or receivers. One undo puts every plan back.
- **Rooms from plans (experimental, Claude Opus 5.5 or newer).** Behind the same switch. Claude reads each plan on a floor twice, for rooms, doors, windows and stairs together, and proposes outlines for the rooms you have. Rooms the two reads agree on are ticked; rooms where they differ, or that would leave half or more of their calibration spots outside, start unticked for you to look at, and Read again makes a third read. Accept all saves the floor in one save with one backup and one undo. Your rooms are never renamed or removed.

### Changed
- **Showcase can start on West Coast Forest.** In forested places (much of central and northern Europe, and the Pacific Northwest coast) the first time you turn Showcase on it starts on West Coast Forest instead of Classic. PadSpan reads this from Home Assistant's own location settings, and nothing leaves your house. If you already use Showcase or have picked a theme, nothing changes.
- **Rain looks like rain, not snow.** Thin, fast streaks on a slight slant, in Live Aboard and on the flat Atlas. Snow is unchanged.
- **No shop links.** The Bluetooth tips and the website's tag and wall-screen guides say what to look for instead of linking to products.

### Fixed
- **On a wall, the flat Atlas uses the whole height again.** The scene row lies over the foot of the screen and fades with the other controls. Zooming past 100 % keeps the house on the screen.
- **On a wall, everything fades together.** The ⋯ button and the Motion chip now fade with the compass and the bars after 30 seconds, and the first touch only wakes the wall. The ⋯ list fits a 1280×720 wall without scrolling, and nothing in it leads a wall away to another page.
- **The Vacation Mode banner** no longer covers an open list or menu, and stays in sight in full screen.
- **Live Aboard:** each floor's coloured line follows the house's own outline; a light strip on a deck railing stops where the railing does; stair railings meet in a post at each landing; room names and chips move clear of each other; ⟳ 90° and short screens keep the whole house above the scene row; scene names show whole.
- **West Coast Forest on the flat Atlas** no longer leaves dark, treeless columns under the upper floors.

---

## 0.38.230 — A floor shown alone gives way to an alarm on another floor (2026-11-10)

### Fixed
- **An alarm on another floor still shows.** With one floor chosen on the sidebar Atlas, a leak, smoke, CO or gas alarm going on a floor that isn't chosen (or an opening Alert pulse flags there) brings the other floors back, faded, with the alarm's ring on top, until it clears.
- **Find active says when what is on is on another floor,** instead of doing nothing.
- **Rooms from plans (experimental): undoing a new room keeps a receiver that was already assigned to that name.**

---

## 0.38.229 — A chosen floor fills the Atlas (2026-11-10)

### Changed
- **Choosing a floor on the sidebar Atlas shows that floor alone, as big as the screen.** The other floors used to stay in the drawing, faded, so the chosen floor was no bigger than in the stack. On a wall screen a floor is now nearly twice the size. All shows the stack as before, and so does a floor stepped to in Live Aboard when you switch back to Map. To keep the other floors, faded, tick **Other floors, faded** in the ⋯ list (Show on this screen) in Live Aboard: it is this screen's own choice. Mapping still fades the other floors, since its tools place things by them.

---

## 0.38.228 — Rooms from plans (experimental); merge rooms and add or remove corners in Mapping → Rooms (2026-11-10)

### New
- **Rooms from plans (experimental, Claude Opus 5.5 or newer).** Live Aboard → Edit → Plans gets a third tab beside Line up plans. Claude reads each plan on a floor twice, the whole plan each time, for its rooms, doors, windows and stairs together; the plans are read where they are placed now, and a floor whose line-up isn't finished says so, with a button to finish it. Your rooms are matched by where they lie, never by their printed names, and are never renamed or removed. Where the two reads agree, that outline is proposed and ticked even if yours differs; a room whose reads differ says "look closely", isn't ticked, shows both reads, and Read again makes a third read so two of three decide. A room whose calibration spots would fall outside its new outline says how many, and you choose: keep yours, or use Claude's; when half or more would, it starts unticked. Printed spaces inside none of your rooms can be merged into a room, added as a new room with a name you pick, or left out; rooms and spaces selected on the map merge into one clean outline, square-cornered on a plan that is turned too; a merge of something that doesn't touch is refused with the reason. Doors and windows both reads found are placed on their walls; one read only is a maybe, unticked; one already in your 3D house is offered as a correction (unticked) that moves or resizes it, never a second one. Stairs are matched against the 3D house's.
- **One save for the floor, one undo.** Accept all for this floor saves everything ticked in one save, after one safety backup. It stops only to keep your data safe (a plan or a room changed since the read, a backup that couldn't be made). A second save in the same session works for what isn't saved yet, without reading again. Undo this rooms session, in the tab and in Settings → AI, puts it all back, a room saved twice included; a new room made under a Home Assistant area's name gives the area its own settings back; anything changed since is left as it is. Off unless Build from plans is on; signal walls and open edges aren't read.
- **Mapping → Rooms: Merge into one, and add or remove a corner.** Select two or more rooms and Merge into one gives the room you pick one clean outline round them all (asked first, with a safety backup; your other unsaved edits stay); with one room selected, double-click a corner to remove it, or press the + halfway along a side to add one. Rooms made by Rooms from plans edit there like any other.

### Changed
Bluetooth: the antenna and Ethernet scanner tips describe what to look for instead of linking to a shop.

---

## 0.38.227 — How much AI PadSpan uses; The ⋯ button on a wall; Line up plans (experimental); Wall and Atlas fixes (2026-11-10)

### New
- **Claude reads this month (experimental).** Settings → AI now shows, under the AI Task, how many reads PadSpan sent to your AI this calendar month. For a Claude AI Task (Home Assistant's Anthropic integration) it also shows about what they cost: "Claude reads this month: 412, about $6.80". That figure is an estimate from each picture's size and each question's length, because Home Assistant doesn't pass on what Claude counted. The exact numbers are on the Anthropic Console's Usage page (platform.claude.com/usage), filtered by the key Home Assistant uses. For any other AI it counts reads only. Administrators only, and only once an AI Task is chosen or there were reads this month: a house that doesn't use AI sees nothing new.
- **Your monthly credit, and a warning.** Type your monthly credit to see "of your $200 monthly credit". It is empty until you type one. "Warn me" is off until you choose 50, 75 or 90 %. Then one Home Assistant notice comes, once a month, when the estimate passes that share.
- **Why a read stopped.** Reads that didn't finish are listed by why: "3 reads stopped: out of credit". The other reasons are couldn't be reached, no answer in time, the AI declined, an answer PadSpan couldn't use, and no AI Task that can do it. This covers photos, the stair finder and Add data via plans.
- **In the usage report, if you have it on:** counts and rough bands only. That is reads per feature, by maker, stops by reason, last month's reads and estimate in bands, and the warning's share. The AI Task, its model, the amount you typed and any exact figure are never in it. The counts themselves stay on this Home Assistant: they are not in backups, and a Factory Reset empties them.
- **Build from plans: advanced plan alignment (Claude, experimental).** A new switch under AI map-building research in Settings → AI, off for everyone. It shows only when your main AI Task is Home Assistant's Anthropic integration running Claude Opus 5.5 or newer (any Fable or Mythos too); any other AI keeps it hidden. Administrators only, Pro, with Live Aboard on.
- **Line up the plans of one floor (experimental).** Pick a floor; Claude reads each plan's printed title, rooms, stairs, outside corners and dimension lines, and PadSpan measures: the ticks of each dimension, pixels per metre, how far a scan is turned, which plan agrees with its own printed dimensions (the one the others are lined up to), and how each other plan matches it picture to picture. A placement is proposed only when the picture match and the printed dimensions agree. A plan that shows another floor is offered a refile, and "This plan isn't Basement?" asks for one by hand. Your measured plan, the one that set your house's metre scale, is never moved.
- **Check each proposal on the 3D view (experimental).** The plan as proposed in red over the plan it is fitted to in blue, purple where they agree, its outline now and proposed, and an arrow for every calibration point, scanner or light drawn on it, from where it is stored to where its click would land. "Show me the dimension" marks the printed dimensions a proposal stands on, on the plan. With no 3D view, or as a list, the same proposals are cards.
- **Save and undo (experimental).** Accept saves one proposal; Save line-up saves together only the ones that shift nothing drawn on their plans. Each save takes a safety backup first (the last six kept in their own slot) and moves only the plan's picture, through the same writer Mapping → Align uses: its calibration check refuses a save that would put most of a plan's calibration points off its picture. Calibration points, rooms, receivers and everything placed in metres never move. Undo this line-up session puts every plan back where it was; it stays in Settings → AI even if your AI Task stops being Claude. A save cut short by a restart is finished or taken back the next time.
- **The little help.** When something can't be settled it asks one small thing, at most three a floor: confirm a printed dimension, or tap the same corner on two plans. An answer reruns the measuring only, with no new AI read.
- **Every stop says why.** A stop (Claude out of credit or unreachable, out of time, a question waiting, a refile refused because things are drawn on the plan, a group with effects, the calibration check, a backup or an undo that couldn't be made, and the rest) is shown in plain words with what to do next, and Resume where the run can continue. Stops are counted per month on this Home Assistant. It never falls back to another AI.
- **In the usage report, if you have it on:** counts and bands only (runs, reads, stops by reason, fit quality, questions asked and answered, proposals shown, saved, undone, and how saves went). Never a plan, a title, a room, a floor, the AI Task, a coordinate or an amount.
- **The scene row under Mapping → Atlas too.** The row of small scene maps now shows under the map in Mapping → Atlas and in its Live Aboard, as on the sidebar Atlas: Home Assistant's scenes with a placed light and the Whole house presets that light one floor. A tap runs one, again turns its lights off; administrators get ✎ and + New scene. That screen's ⋯ list can hide it.

### Fixed
- **A read turned down right after a restart no longer empties the month.** When the first AI event after Home Assistant started was a read turned down for want of an AI Task, the month's reads, its estimate and the warning's marker were written over. They are now read back first.
- **The estimate reads your Claude model the way the plan line-up's unlock (experimental) does.** One place in PadSpan now reads which Claude model your AI Task runs, for both, so a name like "Claude Opus 10" is the same model to each (a model with no known price still shows no dollar figure).
- **On a wall, the ⋯ button now fades with the compass.** When nobody has touched the wall for 30 seconds, the compass and the bottom bars fade away. The ⋯ button used to stay behind on its own. It now fades with them and comes back with them at the next touch, and that first touch only wakes the wall.
- **The dot on ⋯ shows from the start.** A screen where you had ticked or unticked lines in Show on this screen did not show the dot on ⋯ again after a reload, until you changed the list. It shows as soon as the house is drawn now. It is also larger and in the theme's green, so you can see it from across the room.
- **A refile you undid can be saved again.** Saving or undoing a refile changed what the line-up takes as the plan's picture, so the refile, and anything else proposed on that plan, showed as changed and couldn't be accepted again. A plan now counts as a new picture only when its picture itself changes, not when its floor, rooms or scanners are saved. What plan reading stored before this update (finds you marked as wrong, open suggestions) still matches.
- **Resume after a save (experimental).** A line-up that stopped short (out of time, credit or reach) and then had a proposal saved or undone refused Resume as "a plan was moved in Mapping", and couldn't be resumed again. Its own saves and undos no longer count as a plan moved by hand.
- **A plan saved in a line-up stays saved through an answer (experimental).** An answer that made another plan the one the others line up to could offer a plan already saved in the session again, and could offer to move the old anchor from under a plan saved lined up to it; a second save of one plan couldn't be fully undone. A saved plan now keeps its saved item, and moving a plan others were saved lined up to is refused until the session is undone, as changing its scale already was.
- **The last check before each write covers the anchor and a refiled plan (experimental).** If the plan another was lined up to is moved by hand while a line-up save is under way, that plan isn't written onto the old position; and a plan about to be refiled that has something placed on it meanwhile isn't refiled. Each is refused and said, and what was already written is put back.
- **No one's house details in the code's notes (experimental line-up, AI credit tracker).** Two comments in the files PadSpan installs named a test plan's file name and a monthly credit amount; they now say it in general terms.
- **⟳ 90° keeps the whole house above the scene row.** After turning the 3D house a quarter with ⟳ 90° (without Fit), a corner of the house could dip behind the row of scenes, on a wall too. A turn now frames the house again at its new angle, the way Fit does. Zoomed in, it turns as before; zoomed out, it stays as far out.
- **On a wall, the Motion chip fades with the other controls.** When nobody has touched the wall for 30 seconds, the bars, the compass and ⋯ fade away; the Motion chip used to stay. It now fades with them and comes back with them at the next touch. A first tap where its colour key was only wakes the wall, as on the other faded controls; it no longer reaches a light under it.
- **On a wall, ⋯ Show on this screen fits without scrolling.** On a 1280×720 wall the list had to be scrolled. On a wall it now spreads across the screen in up to four columns with each line's plain name; a line that isn't set up keeps its short note. The rows are still big enough for a finger, and the alarms line is always there.
- **The Vacation banner stays in sight in full screen while a list is open.** In browser full screen, opening ⋯ Show on this screen or a menu sent Vacation Mode's banner behind the map. It now stays over the map, with the open list still on top where the two overlap. On a wall it already sat under the open list, and still does.
- **On a wall, the flat Atlas gets its height back.** Since the scene row came in (0.38.225), it sat under the flat map on a wall and took about an eighth of the screen's height, so the house was drawn smaller with space round it. On a wall the row now lies over the foot of the screen, and fades with the other controls when nobody is there, so the map uses the whole height again.
- **Zooming the wall's flat Atlas past 100% keeps the house on the screen.** With West Coast Forest on, zooming a wall's flat map in past 100% could push the house off the screen, down on an upright wall (or up), where it couldn't be scrolled to. It now grows in place.
- **West Coast Forest: no dark, treeless curtains under the upper floors.** On the flat Atlas, the forest left a dark empty column hanging from each upper floor down to the floor below, since 0.38.218. Only the floors themselves are cut out of the forest now; the forest floor and its mist run on between the floors, and no tree stands there.

---

## 0.38.226 — Live Aboard polish: menus over the Vacation banner, names clear of each other, whole scene names, the whole house above the scene row (2026-11-07)

### Fixed
- **Menus open over the Vacation Mode banner.** While Vacation Mode was on, its banner in the middle of the screen sat on top of Live Aboard's ⋯ "Show on this screen" list and the Views ▾ menu, so on a wall half the list was hidden behind it. An open list or menu now sits over the banner; close it and the banner is on top again, Options and Disable working as before.
- **Room names and outdoor chips no longer sit on each other in Live Aboard.** A room's name and a chip beside it (an outdoor sensor's "Entry outside 21°" over "Pantry", say) could be drawn one on top of the other, so neither could be read. Once the house stops turning, a name or chip that lies on another now moves up or down just enough to stand clear; both stay shown, nothing jumps about while you turn the house, and it goes back to its own place once the way is clear.
- **Scene names show whole in the scene row.** A tile that said "Part on" cut its name short ("Kitchen bri…"). The name now has the tile's whole width: when the name and the state don't both fit, the state moves just under the name on the right. Only a name longer than the tile is cut, and holding the pointer over it still shows it in full.
- **The whole house shows above the scene row on a short screen.** On a short screen that isn't a wall (a laptop, a 720p screen), with the scene row showing, Live Aboard's framing kept the house at least 60% of the view's height in the middle of it, so with the scene row and the bar under it, the front of the house sat behind the row. Fit and the first view now fit the house in the space the top line and the bottom bar leave, as walls already do: the whole house shows above the row, a little larger than before, and turning it keeps it there. Taller screens, and screens without the row, frame as before.

---

## 0.38.225 — West Coast Forest as the first look in forested places; Floor lines, railings and rain in Live Aboard; A row of lighting scenes under the Atlas and in Live Aboard; Show on this screen: the ⋯ list in Live Aboard (2026-11-07)

### New
- **Your lighting scenes as small maps.** Under the sidebar Atlas's map, and along the top of Live Aboard's bottom bar (above Walls, the floors and Iso / Top / Fit, never on them), a row of small maps, one per scene: Home Assistant's scenes that set a light you have placed, and your Whole house presets whose lights that are on all sit on one floor (marked Preset). Each map is that floor with its rooms: the scene's lights lit in their own colour where it is known (glowing while they are on now), every other light faint, its name underneath and On, Part on or Off beside it. A scene that reaches other floors shows the floor with most of its lights and says the others ("+ Upper"). Many scenes: the row scrolls sideways. On the sidebar's flat map the row waits at the bottom of the screen while the map runs on below it. It is on wherever the house has such a scene or preset, on the wall too.
- **Tap: on if mixed, then off.** A scene whose lights aren't all on runs (a preset is applied, but only on its own floor: a light it saved as off on another floor is left alone); once all its lights are on, a tap turns them off (a preset's: the lights it turns on).
- **Making scenes.** + New scene at the end of the row, and ✎ on a scene, open Home Assistant's own scene editor (administrators). A scene made in YAML or by another integration says so and opens Home Assistant's scene list. A preset's ✎ opens the Whole house bar on the same page with that preset chosen. Anyone who isn't an administrator is told an administrator makes scenes in Home Assistant. Settings → Atlas has a Scenes line with the same + New scene and All scenes.
- **⋯ → Scene row.** Any screen can hide the row from Live Aboard's ⋯ list (the flat map under it follows). With no scenes yet, the line says so, and Yes › opens the new-scene editor.
- **Opt-in usage report (counts only):** the row shown, a scene run or turned off (a Home Assistant scene or a preset), a new scene or an edit opened. Never a name.
- **⋯ beside the compass: pick what this screen shows.** A small ⋯ at the top left of Live Aboard, on every screen and on the wall too, opens a checklist of everything the 3D house draws, in groups: Lights (lights, light glow, LED strips, ceiling fans), Motion and sensors (motion sensors, motion in rooms, motion reach, temperature and air), Doors, windows and locks (doors, windows, garage doors and gates, locks, railings), People and tracking (receivers, beacons and tags, people, trails, device codes), The house (furniture, devices in furniture, stairs, room names, room outlines, floor outlines, the roof) and Weather and look (rain and snow, theme colours, West Coast Forest trees). Untick a line and it is gone from this screen only, costing nothing; every other screen, and the house's own settings, stay as they were. Back to house defaults puts every line back. A dot on ⋯ says this screen has changed something.
- **Alarms are always shown.** Leak, smoke, CO and gas alarms, with their ring and pill, are in the list ticked and greyed.
- **Something not set up yet says so.** A line for something your house doesn't have ready yet (rain with no weather source, no receivers placed, no motion sensors, the forest without its theme…) stays in the list with one short line and a Set it up button that opens the place in Settings or Mapping where it is set up. Each line with a home there has a small link to it too, and Settings → Atlas is at the bottom.
- **People and tags.** A screen can hide people and tags. When they are off for the whole house, ticking them takes an administrator to their switch (Views ▾ → Show people), and tells anyone else that an administrator turns them on there.
- **Views ▾ → Show on this screen** opens the same list; Views ▾ keeps its own switches.
- **Opt-in usage report (counts only):** the list opened, each line hidden or shown again, a "not set up" line seen and followed, someone sent to where people or tags are turned on, and Back to house defaults. Never a name, a room or an address.

### Changed
- **Showcase can start on West Coast Forest.** If your home is in Germany, Austria, Switzerland, Sweden, Finland, Norway, Estonia, Latvia or Slovenia, or on the Pacific Northwest coast, the first time you turn Showcase on it starts on West Coast Forest instead of Classic. PadSpan reads this from Home Assistant's own location settings, and nothing leaves your house. If you already use Showcase, or have picked a theme, nothing changes. Pick another theme any time in Showcase options → Theme.
- **Rain looks like rain, not snow.** In Live Aboard and on the flat Atlas, rain now falls two to three times faster, as thin short streaks on a slight slant, with more of them. Heavy rain is denser and faster still. Far-off drops stay streaks instead of turning into dots. Snow is unchanged: slow, soft, drifting flakes. The drawing costs no more than before.
- **Railings in ⋯ takes stair rails too**, their spindles and posts with them (the steps stay), not only deck and open-edge rails.

### Fixed
- **Each floor's coloured line follows the house.** With the Atlas look, Live Aboard draws a thin line in each floor's colour round that floor. It was a rectangle round all of the floor's rooms, so on a house that isn't a plain box its lines ran out over the yard and hung in the air well past the walls. Now each line follows its floor's own outline, just outside the outside walls, at that floor's level, and it hides with its floor.
- **A light strip on a deck railing stops where the railing does.** An LED strip placed along a deck's glass railing was drawn at its full length on top of the rail, so a strip longer than that stretch of railing (or placed near its end) ran on past the glass and round no corner, like a second top rail out in the air. It is now drawn only along the railing it sits on.
- **Stair railings meet cleanly at a landing.** On stairs that turn (L, U and the longer turning shapes) with a balustrade, the landing's rail started in the air beside the flight's post, a step above it, and the next flight's rail began with no post at all. Every rail now ends in a post that reaches it: each flight has a post at its foot, and the landing's rail runs into the flight's post.
- **A wall screen is never led away.** On /padspan-lights?kiosk=1, nothing in Live Aboard's ⋯ list or the scene row opens another page any more (a link used to leave the wall on the main panel with no way back). A line that isn't set up says plainly where to set it up from another screen ("Set it up from another screen, in PadSpan → Settings → Atlas → Outdoor weather").

---

## 0.38.224 — The stable after 0.38.199: guided Setup, Receivers and Rooms pages, one name for each device, no online maker lookup, railings only where you choose, and fixes (2026-11-03)

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
- **When it's close, it asks.** One quiet line says "This looks like Car Keys: same device?" A No means no more questions about that device for 7 days, though clear evidence can still link it. Otherwise it asks at most once a day for each device. The question closes itself if the old address comes back. "Now on ..." has Undo, and all of this survives a restart.
- **Following a name only moves what's on screen.** Calibration, learning, Follow's alerts and Home Assistant's sensors stay on the first address, so a wrong link can't mix another device's signal into them.
- **West Coast Forest, a new Showcase theme (Pro key).** Dark colours for the whole map, and a forest of Douglas fir, cedar and hemlock round the house: on the flat Atlas behind everything on the map, and in Live Aboard as real trees standing in the mist, with ferns, logs and mossy rocks. Pick it in Showcase options → Theme.
- **That forest on a bright sunny day.** When the weather says sunny, in daylight, the mist clears and a little sun gets through. It stays a dark forest, and every other day and night stays misty. In Live Aboard no tree stands on or over the house, what stands in the way dissolves, and Edit and Furnish leave the forest out. A slow screen draws fewer trees, and one too slow goes without.
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
- **West Coast Forest shows as Classic,** with no trees in Live Aboard.
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

---

## 0.38.223 — West Coast Forest on a bright sunny day (2026-11-03)

### New
- **A hint of a nice day.** When the weather says sunny and it is daylight, the mist clears, soft flecks of sun fall on the forest floor, the side of the trees toward the sun catches the light, and blue shows through the canopy. It stays a dark forest. Every other kind of day, and every night, looks as it did.

---

## 0.38.222 — West Coast Forest's trees are conifers (2026-11-03)

### Fixed
- **The trees in West Coast Forest looked like palms.** Each tree was a few big boughs on a long bare trunk. They now have pointed crowns that start lower, made of many short branches with no stem down the middle. Douglas fir, cedar and hemlock read as what they are, from close up and from far off.

---

## 0.38.221 — West Coast Forest grows real trees in Live Aboard; Fixes before the stable: a restart keeps a name's notes, the alarm word in Plans is live, questions close themselves (2026-11-03)

### New
- **Showcase's West Coast Forest now stands up in 3D.** When Live Aboard follows the Atlas's look with that theme on, the house sits in a dark Pacific Northwest forest: tall Douglas fir, western red cedar and hemlock with long bare trunks and drooping boughs, a near-black mossy floor with sword ferns, salal, fallen logs and mossy rocks, going back into cold mist under a dark overcast sky. Rain falls in the trees. The same house always gets the same forest.
- **It keeps out of your way.** No tree stands on or over a room, outdoor room or deck, and anything between the camera and the house dissolves at any angle, on Top and on the way to a room. Edit, Furnish and the Plans tool's vetting map leave it out. It adds no setting and costs nothing at rest; a slow screen draws fewer trees, and one too slow for them goes without. With any other theme or look the file is never fetched.

### Changed
- **A very large home stays bounded.** The search for a named device's new address used to cost devices times addresses on every poll, 288 ms with 20 named devices among 9,178 addresses. Each poll now has a limit, and a device that misses its turn goes first on the next, so a link can come a little later but never differently. Ordinary homes don't reach it. The usage report (opt-in) counts the polls that do.
- **The third-party notices now come with the download,** in both editions, not only in the repository.
- **A No covers the device for a week.** After a No to "This looks like Car Keys: same device?", there are no more questions about that device for 7 days, though clear evidence can still link it on its own. Otherwise each named device gets at most one question a day, where one rotating every 15 minutes could get 95, and that question follows the device's newest address, so a late Yes lands on the address it uses now. Both survive a restart, Factory Reset clears them, and the usage report (opt-in) counts the questions held back.

### Fixed
- **A restart no longer forgets a name's link, No answers and Undo.** For a device whose address a radio calls random but which doesn't look rotating, off the air at a Home Assistant restart, the first moment after the restart wiped them and saved that. About half of random addresses look like that. Now nothing is decided until the device history has loaded, so "that address isn't linked again" holds after a restart too.
- **A name that moved stays on screen after a day.** Once the first address had been silent for a day (the default history), the name's row went and the new address came back as a stranger's. For about half of random addresses its link, No answers and Undo were deleted too. The row now stays while it has a link or an open question, and the notes stay whatever happens to the row.
- **The alarm word in the Plans map is live.** With the map open, nothing refreshed it: a real alarm could go unsaid, and a word could stay after the alarm was over. Now a smoke, gas, CO or leak alarm shows over the view within about 5 seconds, drawn on the map as well, and one that's over goes as quickly. Only the alarms are read; the map, the card and what you're drawing are left alone.
- **The emergency banner shows on Mapping too.** Mapping's tab didn't read alarm latches at all, so the banner never came while you stayed on it. It now comes as on the other tabs, within 30 seconds, and within about 5 while the Plans map is open.
- **A question closes itself when the device comes back.** "This looks like Car Keys: same device?" stayed up even with the old address on the air again for days, and a Yes then undid itself on a later report and refused the new address. Now the question goes as soon as the old address is heard, without counting as a No.
- **"Nothing else fits" now holds when two devices stop seconds apart.** Two named devices with the same name and maker that stopped a few seconds apart could give the name to whichever stopped first. Now a new address that could be either links to neither.
- **West Coast Forest on a turned wall.** With `?wall_rotate=90` or `270` the trees were smeared and the house-shaped gap was in the wrong place. They now draw as on a screen hung that way.
- **A double click on Yes or No answers once,** without a red "That question isn't open any more" over a Yes that worked.
- **"3 plans cover Main: all are read",** not "both".

---

## 0.38.220 — One name for each device, what it is, and how PadSpan knows; Device makers come from the official lists, and nothing is sent; Only this floor on the flat Atlas: the choices settled; A name can follow a device whose address changes, on screen; Live Aboard: a raised marker moves clear of the words around it; Add data via plans: keep what the AI found, undo it in one go (experimental); Add data via plans: lights (experimental); Add data via plans: the vetting map (experimental) (2026-11-02)

### New
- **One name on every screen.** A device now reads the same everywhere, from the strongest source there is: the name you gave it, the phone's or Home Assistant device's name, the name it broadcasts, then its maker ("Samsung device"), then "Unnamed device". The address sits underneath instead of being the name, and where you pick a device (Follow, Calibration, Presence, Monitor, Locate, a room's window) a name that is only a maker or a service gets the end of its address: "Apple device · 8A:3B:63". A stronger name replaces a weaker one, never the reverse, and a name a device broadcast once stays.
- **What a device is, read from its own broadcast:** Windows PC and the other Microsoft types, AirTag, AirPods or Beats, Find My accessory, Fast Pair accessory, Find Hub tag, Samsung SmartTag, Tile, Eddystone beacon, Xiaomi models, Shelly and Shelly BLU, RuuviTag, Govee. Apple's broadcasts mostly don't say whether they come from an iPhone, an iPad, a Mac or a Watch, so those read "Apple device".
- **Fixed or Rotating.** A badge says what a receiver reported about the address. Devices, By Room and All objects gather the rotating addresses nobody named by kind ("169 Windows PC addresses"), and older rows fade. Nothing is deleted; click the line to see the rows, or search: a search opens a group it matches. Devices shows at most 300 lines at once and says how many more an open group holds.
- **The device window says how PadSpan knows:** "Apple, from its company number. AirTag, from its Find My broadcast." Where a company only holds a service number the device uses, it reads "Uses a service from Google" rather than calling it the maker. And a "Copy raw broadcast" button, for a bug report; it hides any IRK and gives only the name the device broadcast, never your label.
- **A name can follow a device whose address changes.** A device you named or follow, with no IRK or fixed ID, used to keep its name on the first address, which then aged while the device carried on under a new one as a separate row. Now the name and the row can move to the new address. It happens only when all of this holds: the new address started as the old one stopped, it sends the same name or the same data, from the same maker and of the same kind, at least two receivers hear it where they heard the old one, nothing else fits, and no radio calls the address public.
- **This moves what's on screen, and nothing else.** Calibration, learning, Follow's alerts, Home Assistant and PadSpan's saved ids stay on the address you named the device by, so a wrong link can't mix another device's signal into them. Home Assistant's sensors for that device keep reading its first address.
- **When it's close but not certain, it asks.** One quiet line on the device's row and the new address's: "This looks like Car Keys: same device?" Yes moves the name for that address, and No is remembered. It's not a window, and it doesn't appear on wall screens, or in Basic outside the device's own view.
- **Undo.** "Now on ..." on the device's row has Undo. One click puts the name back on the first address, and that address isn't linked again.
- **A pointer to the certain way.** A named device that keeps changing gets one line pointing to its IRK, once, with Dismiss. With an IRK, a phone or watch is recognised for certain.
- **The usage report (opt-in) counts how this goes:** links made, questions asked, yes, no, undone, and links that proved wrong. Counts only, never a name or an address.
- **Keep a stair the AI found, or take its position (Plans tool, experimental).** In Live Aboard's Edit → Plans list, New and Take the AI's position now work. They go into your draft like any other edit, so Undo and Discard take them back and nothing is kept until you press Save. A new stair is labelled "Stairs (from the plan)" and has no railing. A second staircase stacked over one asks first which floor it climbs from. A correction moves only where the stair stands, never its shape, size, turn, style or colour, even from a draft older than the stair; on a stair you placed yourself the keyboard starts on Keep mine, which notes "already here" and leaves your stair alone. A railing hint asks for a side and a style, starting on the stair's own style, changes only those two, and goes on a stair that is kept. There is no "accept all".
- **Save checks first, and writes only your 3D house.** Save sends what you kept through one command: it checks each item again and refuses any whose stair or plan changed since you looked ("changed since you looked"; a stair you deleted never comes back), makes sure there is a safety backup, and writes your 3D house and its own record together. That backup has one place of its own, so it never pushes out another backup: a later session's replaces it, and a session whose backup has gone takes a new one. Restoring it takes back what was kept, in a house that had no furniture too. A keep never writes the map, rooms, walls, floors, scale, settings or calibration. If a write fails, or Home Assistant stops between the two, everything is as it was or the whole keep stands, never half. Two admins, or a double click, make one stair. Your other edits in the same Save go after it, as they always do, including a drag or any other change of your own on a stair you also kept something on.
- **Undo this session, in the list and in Settings → AI.** One undo takes back everything a session kept, exactly as it was, and what you keep after a put-back joins it. Anything you changed since is left as it is, and it says how many; that includes a stair you changed by hand in the same Save as a keep. The undo can itself be put back, until you keep something else in that session. "Already in your house" in a later list becomes an item you can keep once that stair is gone. Marks of wrong and later stay as they are: they go to the server the moment you click them, so neither Discard nor a closed page loses them.
- **Usage report (when on):** counts only: each item kept as new or as a correction, per kind; corrections taken on a stair placed by hand or by the AI; a kept stair moved over 30 cm before Save; a stacked stair taken; whose side a railing kept has; how each keep or undo ended; each undo, by kind, and what it left. Never a plan, a name or a position.
- **Lights in the Plans tool, only if you ask (experimental).** Tick Lights in Live Aboard's Edit → Plans, then say for each plan whether it draws light fixtures, like circles or pot marks: Yes, No or Not sure. Most architect's plans don't; electrical sheets do. Only a plan on Yes is read for lights, after everything else: nine overlapping tiles, finds within 30 cm taken as one, and a closer look at each, 2.5-3 minutes a plan. If the AI's first read took over 45 seconds the tiles are skipped and the sheet says why.
- **A symbol can change what a placed light is drawn as, and nothing else.** Within 60 cm of a placed light (of its outline, if it has one), a symbol that agrees is "already in your house", and one that differs is offered as a correction of that light's kind in Live Aboard. Its height and strip layout stay. Where a room's lights are placed as one group, the card says "this room's lights are placed as a group: kind only?". Take the kind goes into your draft like any other edit, and Save, Undo this session and Keep mine work as they do for stairs. The plans never add, place or move a light, and never touch the map.
- **A symbol with no placed light isn't held against the AI.** Further than 60 cm from every placed light it is listed as such, with a button that opens Mapping → Atlas on that room so you can place the light yourself. On a plan whose AI answers in a picture size PadSpan can't confirm, no kind is offered either, because a symbol can't be said to be on a light there.
- **On the vetting map** lights are dashed ghosts with pins and the same card as stairs. Keys C, F and L work on them; N doesn't, as a light is never new here.
- **Usage report (when on):** counts only: each plan's answer to the fixture question, how many tiles a session read, tiles skipped for a slow AI or the time running out, what the closer look did to a light, what was suggested, what was already there, a symbol with no placed light (apart from the AI's failures), each verdict and each undo. Never a plan, a name or a position.
- **The vetting map (Plans tool, experimental).** With "AI map-building research" on in Settings → AI, Live Aboard's Edit → Plans now opens a map: your floor plan under the house, seen from straight above, and what the AI found as dashed ghosts with numbered pins. Lights, sensors, names and weather step aside while you check, and come back when you close the tool. A smoke, gas, CO or leak alarm doesn't step aside: it stays drawn, and its word and place show over the view, even if it's on another floor. Press a pin, or go through the queue one item at a time, and the camera follows. A ghost isn't in your house and cuts no floor until you accept it.
- **One card, one item.** New, Correction, Failure (one reason), Looks right, Later. On a correction your stair stays solid with the AI's ghost over it, a Fade slider and the move in numbers ("1.4 m east"). Move by hand accepts it, then you drag it into place. A stair you placed yourself starts on Keep mine. A stacked stair asks which floor it climbs from, and where two plans disagree both ghosts are named and a switch shows each plan. Keys: N, C, F, L, Enter, Backspace, Z, P.
- **No accept-all.** The only bulk action is Dismiss the rest, which puts what you haven't looked at off to Later, never to wrong. A recap comes every 25 verdicts and at each floor change, and each floor ends with a what's-missing pass: plans with no stairs found, your stairs a plan didn't show, items ignored before.
- **The house's own track record, not a confidence number.** Once five items of a kind are decided, the card says how often the AI has been right in your house.
- **On a phone** the card is a bottom sheet, pins are 44 px and two fingers move the map. Wall screens and Basic never show any of this, and with the switch off nothing of it loads.
- **The list stays**, under More → As a list. With no 3D on a device, Mapping → Furnish offers it directly.
- **Usage report (when on):** one more count: a stair added by hand after the what's-missing pass. Never a plan, a name or a position.

### Changed
- **A receiver goes by one name on screen.** The one set on its ESPHome or Shelly device, without the address Home Assistant adds: Overview's floor labels, Calibration's Tune and Beacon Tune, QA and Health. What calibration already saved under a receiver stays as it was saved.
- **"Find My accessory" no longer says "another brand's".** AirPods read that way too: at the house, 83 addresses with that Find My value also send AirPods' pairing message. AirPods are now told by that message.
- **Apple is no longer named as the maker of HomeKit accessories and that Find My value without AirPods' message.** They use Apple's company number whoever made them, as iBeacons do, so they read as what they are, with no maker. Calibration's beacon groups don't change.
- **Forensics' CSV has two new columns at the end,** `best_name` and `what_it_is`, with PadSpan's name and what it worked out. `name` and `device_type` stay what the device sent, for anyone reading a file.
- **The usage report (opt-in) counts** where the best names come from, how many devices have a type, and how many a receiver says are fixed or rotating. Counts only.
- **Device makers now come from the official lists, built into PadSpan.** The old company table had 36 of its 53 entries wrong: Samsung showed as "Beats Electronics", a Logitech mouse as "Oura". It is replaced by Bluetooth's full company list (about 4,060), and a service number in a device's broadcast can now say whose service it uses ("Uses a service from Google"), out of the 725 Bluetooth assigned to companies. That isn't called its maker, because other makers' devices use them too. A device's company number or confirmed fixed address comes first.
- **The online maker lookup is gone.** Opening the Objects list no longer asks macvendors.com and maclookup.app anything. A built-in list from IEEE answers instead, on your own machine, so nothing is sent, and the "Look up device makers online" switch has gone with it. The first start removes the answers it kept.
- **"Probably" where nobody can be sure.** The address list counts as fact only for an address a receiver has confirmed is fixed (ESPHome from 2022.12 and Home Assistant's own Bluetooth say so). Shelly, ESPresense and Tasmota don't say, so there a match reads "Probably Espressif". An address a receiver reports as random is never looked up.
- **ESPresense devices can have a maker,** read from the id ESPresense gives them (Apple, Microsoft, Tile, and any company or service number in it).
- **The occupancy estimate matches wearables by their company number.** Adverts with Garmin's, Polar's, Oura's and Withings' real numbers now count, and Logitech, hearing aids and others the old table mislabelled don't. This hasn't been checked with real wearables yet, and a watch left on a charger can now count as a person. Fitbit has no number of its own in the official list; the one the old table used was another company's, so nothing changes for a real Fitbit. Your count may move a little.
- **The usage report (opt-in) gets a few more counts:** how many devices have a real name, a maker and a type; what kind of device each receiver is; how many ids PadSpan's own devices have built up in Home Assistant; and what the merges below and the wearable correction did, including how far it moved the estimate. Counts only, never a name or an address.
- **Leak and open-window rings stay bright on a faded floor,** so an alarm is never dimmed by choosing another floor.
- **A door or window circle you are placing in Mapping now fades with its floor** and takes no taps. Before, it stayed bright and draggable on a faded floor. Choose its floor to drag it; a message says so when its nearest wall is on another floor. Save opening and Discard work either way.
- **The sidebar Atlas scrolls to a saved floor once, when the page opens, and only if its plate is off screen,** so a low saved floor isn't left showing only faded floors. It never scrolls after that: choosing a floor from a chip, Refresh and the page's updates leave it where it is, and a wall screen doesn't scroll at all.
- **A queued light that belongs on another floor isn't placed.** With a floor chosen in Mapping, tapping that floor's plate with a light from another floor places nothing, says "W18 belongs on Upper. Choose that floor first." and keeps it in the queue. Dropping the pin with such a light does the same. With All floors chosen, placing is as before.
- **A followed device keeps its own row every poll.** It no longer merges with another of the same name, with or without a name of yours.
So far this has only been measured on recordings from one house, where very few devices both change their address and send a name. How often it asks or links in other homes will show in the report.
- **A motion sensor's marker no longer sits on top of a room's name.** A marker on its dotted line, with its code under it, now picks a height on that line that clears room names, readouts, device codes and tags' names. Your sensor's stored height and spot don't change: this is only how it's drawn, nothing is saved, and while you edit, everything stands at its real height.
- **It works out the height for the view you're looking at.** It looks once the camera stops, or when what's showing changes, then moves in a short glide. Nothing hops while you turn the house, and a poll with no changes moves nothing. If nothing clears, it takes the spot that covers the least.
- **Looking straight down, the marker leans.** From Top, a height doesn't move anything on screen, so the marker slides a little to one side and its dotted line slants back to the ring on its true spot.
- **A tag's name does the same on its stem**, when Show tags & scanners is on, unless the tag is walking.

### Fixed
- **PadSpan's own Home Assistant devices no longer read back as a device's "HA device".** A beacon labelled in PadSpan showed "PadSpan HA · BLE Presence Tracker" as its maker and model.
- **Hashes of phone numbers, emails and Apple IDs in Apple's broadcasts are no longer kept.** AirDrop, Hotspot and Nearby Action messages carry them; those bytes are zeroed as an advert arrives, and in what history already holds, a message cut short included. Nothing ever read them.
- **Bluetooth → Advertisements said things it didn't know.** "Relabel" and "User Label: <address>" on a device nobody named now read "Tag" and a dash. "Connectable: No" now reads "Unknown" when no receiver said. "TX Power: -127 dBm" now reads a dash when the device declares none. And every iBeacon no longer says "Apple": the format requires Apple's number whoever made the beacon.
- **A made-up UUID could read as a real service.** `abcd1800-1111-…` showed as "Generic Access". Only a UUID on the official Bluetooth base has a short form now.
- **A device you named, pinned or calibrated is never merged with another on a guess.** The merge by same name or same data could absorb one, delete it from history and mix another device's signal into its calibration points. They now stay apart. When addresses do merge, the freshest one leads, so a device on the air no longer reads hours old.
- **A device's id in Home Assistant no longer grows or moves.** An entity already on a device stays on it, so existing devices stop building up ids. One of the house's devices had 1,332. A brand-new entity, such as a new receiver's, can still add one. Existing ids stay as they are.
- **A saved Atlas floor now applies when the page opens.** The Atlas opened on All and only showed the floor kept by Save view after a Refresh, because it checked the floor before it had read the house. If that floor is no longer there, the Atlas opens on All. Mapping opened before the settings arrive now takes the saved view when they do.

---

## 0.38.218 — Only this floor on the flat Atlas, and which page themes reach; Open edges: rooms with no wall between them; Add data via plans: a first, read-only look (experimental); It no longer rains on the Atlas because of a rain sensor that has gone quiet; Stairs read off a floor plan land where they are drawn; Railings only where you choose them; Training's language note, and Calibration Guide points when a beacon moves; Tabs that stay put; fields and cards that fit; Mapping's Edit tools and names; plans that fit the window; Sample mode; Floor names instead of ids, and a few wrong words on screen; West Coast Forest: a Showcase theme with a forest round the house (2026-11-02)

### New
- **Open edges in Mapping → Edit → Signal walls.** Some rooms aren't divided by a wall: a loft, or one big open space. Signal already passes where no wall is drawn, for positioning and for the coverage map alike. What was missing was a way to say so without tracing the room's edge by hand. Now **Open edge: tap a room edge** snaps to the nearest saved room edge and puts an Open (0 dB) wall along the stretch it shares with the room next door, named "Open edge — <room>"; an edge with no neighbour opens whole. An edge two rooms share is marked once. If a signal wall already runs along that stretch, PadSpan asks first and says what changes: only that stretch of the wall goes, the rest stays as it was, and signal does change there, so positions near it can shift. **Open all edges** does a whole room, after asking, and leaves any edge with a wall on it as it is; **Remove open edges** takes a room's back (a wall one replaced has to be drawn again). The 3D house leaves the wall out where an edge is open, as it did for open walls drawn by hand; a new open edge has no railing until one is chosen. The usage report (when on) counts each use of the tool, by kind only.
- **AI map-building research switch (experimental, off).** One switch in Settings → AI now covers every AI feature that builds your map: the stair finder you may already use, and the new Plans tool below. Off hides them all. A home that had the stair finder turned on when it updated comes up with the new switch on, so nobody loses it; every other home has it off. It is an administrator's setting, like the AI Task itself.
- **Add data via plans, in Live Aboard's Edit bar (Plans).** With the switch on and an AI Task chosen, Edit gets a Plans button. Tick the floor plans you placed and your AI reads them for staircases, looks again at a crop round each one to place it (a find that closer look doesn't confirm is left out), and asks whether a handrail is drawn beside it, all inside an 8-minute budget on the server (the page can close and come back). A plan of the outside (a site plan) isn't offered. The sheet names the AI that will read the plans, the backup AI Task too if one is set (it reads when the main one is away, as it does for photos), and says reads can keep the AI busy for up to 8 minutes, which may slow voice if your voice assistant shares it. A session in which no plan could be read says why, rather than that the AI found nothing. Each find is matched against the stairs already in your 3D house (already there, a correction, new, or a second staircase stacked over one) and listed with a crop of the plan for you to check item by item. **This version writes nothing to your house:** you can say an item looks right, mark it wrong (with a reason, and its railing hint goes with it) or later, and manage the items you marked wrong, which are remembered for that plan until it is moved or replaced. Keeping an item as new or as a correction comes in the next beta. Lights, doors and windows are not read.
- **Usage report (when on):** counts only for the new tool: how a session ended (one that read nothing counted apart, with why), whether the AI was local, how many plans and reads, how long each read took, each failure by reason, the budget running out inside the reads, what was suggested and what was already there, each verdict, its reason and any taken back. Never a plan, an answer, a name or a position.
- **Two more rail styles for stairs.** Beside the balustrade (a handrail on spindles): Topless, the spindles and posts with no top rail, and Single bar, one bar with nothing under it.
- **West Coast Forest, a new Showcase theme.** A dark theme for the whole map, and on the flat Atlas it also draws a west coast forest in the outside area round the house: Douglas fir, cedar and hemlock, sword ferns, salal, fallen logs and mossy rocks, going back into mist. It sits behind the map, so it never covers a room, a marker, a name or a light, and it never shows on a floor or between floors. Rain and snow still fall in front of it, outside only. The same house always gets the same forest. It is painted once and again only when the layout changes (floors, spacing, zoom, screen size), not on every update. Pick it in Showcase options → Theme; it needs PadSpan Pro or Bright Pro, as Showcase does. With "Same as the Atlas", Live Aboard takes its dark colours but draws no trees. Every other theme looks exactly as it did.

### Changed
- **Choosing a floor on the flat Atlas fades the others.** Before, only the other floors' plates dimmed: their rooms, names and lights stayed at full strength, yet most of their lights ignored a tap. Now those rooms, names and lights fade to a faint backdrop and ignore taps, so what looks tappable is tappable. Each floor's number badge stays bright and still opens that floor's list. A leak or open-window ring and the ring that flashes a light's spot stay bright too, on any floor. All looks exactly as it did. If the floor you choose is off screen at 100% zoom, the sidebar Atlas now moves it into view, once for a saved view when it reads that view (Refresh) and never on the updates after that. The fade also shows on Mapping → Atlas and Traceback's House activity, which draw the same map. A door or window circle you are placing in Mapping stays bright and draggable, even on a faded floor. While a floor is chosen in Mapping, a light from the placement queue or the drop pin lands only on that floor's plate; a tap or drop anywhere else does nothing, so choose the other floor or All to place there.
- **A new staircase has no rail until you pick one.** Choose Both, Left/Inside or Right/Outside on its panel in Furnish. Stairs you already have were given the rail they showed as their own setting, so nothing looks different; stairs a stair room or the AI suggests start with none.
- **An Open (Loft) edge's railing is a setting of its own.** The Railing button on its row in Signal walls gives it one, or none. Edges you already have keep the railing they show, and that becomes their own setting the first time you Save in Live Aboard; one railed on only part of its length (round a corner, or along a floor room and a raised room) stays as it is until you choose. An edge you draw from now on starts with none. The usage report (when on) counts how many were brought over, by word only.
- **Moving a beacon keeps its Calibration Guide points.** Beacon Tune's hard relocation deleted them with its own points. New Guide points now stay, like Pin & Listen and Roam points. If a moved beacon keeps showing at its old spot, delete them by hand. Guide points saved by 0.38.209 to 0.38.217 are still treated as Beacon Tune points.

### Fixed
- **Settings and the help now say the sidebar Atlas page stays dark.** Settings said a theme applied in every browser and offered Light to anyone who can't use a dark screen, but the sidebar Atlas page never takes a theme. It stays dark on purpose, Light (inverted) included, and Settings → Theme and the help now say so.
- **An open wall saved at 6 dB.** An old path could store an Open (Loft) wall with the default 6 dB loss. An Open wall saved from now on stores 0 dB. One already stored at 6 dB keeps counting 6 dB in positioning and coverage until it is saved again (a door cut, a reshape, the Railing button); nothing changes at upgrade.
- **A rain sensor that has stopped reporting no longer makes it rain.** A sensor that goes silent while wet stays on, and it can stay that way for days, so rain kept falling on the Atlas and in Live Aboard under a dry sky. If the sensor's device has a Last seen sensor and it's more than 3 hours old, PadSpan now treats the rain sensor as having no reading and goes by the weather entity. A sensor with no Last seen works as before.
- **Settings tells you.** Under the rain sensor it now says "This sensor hasn't reported since" and the date, and that it's using the weather forecast instead. The opt-in usage report counts it (`weather_note:sensor_stale`): a name only, never which sensor.
- **Stairs read off a tall floor plan landed metres away, or went missing.** A local AI (Ollama with Qwen2.5-VL) looks at a small picture scaled up, and gives its answers in that larger size, not the size PadSpan named. On a tall plan sent at 1024 px high that put the stairs 22-34 % of the plan away, and anything in the far third was cut short and then thrown out as too small. PadSpan now sends each plan at exactly the size that AI looks at it, so its answers line up; a cloud AI that answers in the picture's own pixels sees no change. Re-scored on saved reads of 16 plans with 20 staircases: 5 right of 9 suggestions before, 15 right of 19 after. Sent afresh at the new size, 3 plans gave 4 right of 4.
- **A staircase with a landing was thrown away.** The AI boxes a U or landing stair together with its landings and calls it straight, which ran past the size limits; those now allow for a landing. The usage report (when on) counts how the AI's boxes fared: kept, dropped, or out past the picture (an AI answering in another frame).
- **Saving a signal wall no longer moves it to the end of the list.** Where two walls overlap in the 3D house the first one wins, so a save could change what was drawn. A wall now keeps its place.
- **Training says which parts are still in English.** In German, French and Dutch, the note now says the walkthroughs and parts of the Quick Start and Full Manual are English, instead of only saying the help is translated.
- **Tabs that jumped on every click.** The chosen tab or filter stretched across a whole row and pushed the others around, on Devices, in Training and in Calibration's Collection Duration. It now keeps its size and is shown as selected, and nothing moves.
- **Fields sticking out of their cards.** Text boxes ran past the edge of the card, or over the box next to them: the Email box over Service in Manage → Events and in Follow, Search over Source in Bluetooth, Mapping's Upload and the guided Setup, and the Diagnostics report. They now fit, and their labels line up.
- **Narrow cards with half the page empty.** Monitor, QA, Sandbox, Health and Diagnostics kept their cards about 225 px wide on a big screen, which cut off Signal Quality's columns, QA's values and Sandbox's Floor Towers. The cards are now wider and share the row. Zones and Overview look as they did.
- **A box round every value in Health.** Each number and name in Health's tables had its own border. They now read as plain table text.
- **Messages you could read through.** A message at the top of the page let whatever was scrolled underneath show through its text. It is now solid, in the same colour and the same place.
- **Sandbox on a phone.** The cards ran 16 px past the edge of the screen.
- **Devices on a phone.** The fourth count, Untagged, was off the screen with no way to reach it. The counts now wrap.
- **Mapping's Library and Compare Maps on a phone.** Map names and room names were squeezed down to a few letters a line. The Open and Delete buttons now get their own line in Library, and Compare's map names go under the room.
- **Floor chips in the Atlas's drawer on a phone.** The drawer was too short and hid the last row of floors. It is now tall enough to show them.
- **Mapping → Edit: the highlighted tool.** Radios stayed lit on every tool, with its hint. The highlight and the hint now follow the tool you are using.
- **The setup wizard's Set the scale step** opened on the Radios tool though it asks you to measure. It now opens on Measure.
- **Measure** showed the whole Rooms tool above its own panel. It now shows only its own panel.
- **Basic's Edit outline and Place receiver** printed a raw list of coordinates under the one tool. It's gone from Basic. Advanced keeps it.
- **Names on the map in Edit and the Alignment Overlay.** Room and wall names came out stretched and huge, ran into each other, and "metal (12dB)" could be cut at the edge. They're now a small, normal size and stay on the map. Wall names now show only in the Signal walls tool, so they don't hide the plan in the others.
- **Tall floor plans on Pin & Listen, Roam and Model** were as wide as the card, so the floor never fit on screen. They now fit the window's height, unless that would make them narrower than 360 px, such as on a phone on its side or with a very long plan on any screen. Then they stay 360 px wide, or as wide as the card if that's less, and the page scrolls. Only the size on screen changes: your calibration points, and where a new one lands, are the same.
- **Sample mode → Guests** said guest tags were off while the house showed a guest. It now shows the guest's stay.
- **Sample mode closing what you opened.** A card you opened on the Overview closed again about every 20 seconds.
- **Opening the panel when Home Assistant was slow to answer.** It could say "Mode: SAMPLE" before it knew, and show your own rooms on the sample house, until the next refresh. It now waits to say, and the sample house replaces what was showing, including when it failed to load the first time. A change made in those few seconds waits for the answer: in Live it then goes through, and in Sample it's refused as usual.
- **Floors go by their names.** Mapping's Library and Layout showed the outside floor's internal id; it now reads Outside. If a floor called Outside from Home Assistant shows there too, the outside plan's own heading or button reads Outside (Exp.), so the two can be told apart. Library lists only floors with plans, so without a plan on that floor its heading stays Outside. Monitor → Zones and the layout tables in Health showed floor ids too; they now show Home Assistant's floor names.
- **The 3D Isometric Preview names the right floors.** On homes with no floor levels set in Home Assistant, the legend could swap floors (Upper called Outside, Outside called Upper), and so could the floor slider's label. Both now take the name from each plan's own floor. A long plan name stops short of the floor name, with the whole name when you hover over it.
- **The phone's top bar says History, Events and Diagnostics** rather than the screens' internal ids.
- **Settings → Tracking says "saved layout".** A leftover old word for it is gone from the device height and GPS Bridge text and from the layout source list. Nothing changes in how they work.
- **Headings said once.** Health's "Problems found", and Basic's Usage report and Guest tags cards, each had the same heading twice in a row.
- **Manage → Events no longer shows a debug line** when no notification service is found.
- **Manage only says "switch to Live" in Sample.** Data and HA Entities said it while already in Live.
- **Example names are neutral.** Door Openers, Bluetooth's device name box and a Training diagram used names and rooms from one particular house.

---

## 0.38.217 — A motion sensor's reach in Live Aboard is soft light (2026-11-02)

### Changed
- **A motion sensor's reach is drawn as soft light.** With Motion picked, on a trigger, or on hover, Live Aboard used to draw it as a pale plate with a bright outline. That outline cut across rooms, and a sensor outside the house showed a large disc on the ground. It's now a soft pool of light, strongest near the sensor and fading out at its reach. Everything shows where it did.

---

## 0.38.216 — The occupancy sensor's real name; Live Aboard on a wall: sharp, and as large as the screen lets it be (2026-11-02)

### Changed
- **A wall draws Live Aboard at every pixel of its screen.** On Auto or High, a wall (`?kiosk=1`) used to stop at about 1440p's worth, and on Auto fell to Low if its graphics chip couldn't turn the house at 30 frames a second. Now it draws High at the screen's full resolution. If the chip can't turn the house smoothly at that size, the picture is softer only while the camera moves, and sharp again as soon as it stops. A 1080p wall on a small Intel PC used to fall to Low on Auto; it now stays on High, sharp when still and turning at 30 frames a second. A chip too slow for that (a 4K screen on the same PC) draws about 1440p's worth, as it did, and on Auto goes to Low if that is still too slow. **Low** chosen in Settings stays Low.
- **Live Aboard fills a wall's screen.** The whole house used to be framed clear of the bars along the top and bottom, even though they fade when nobody is there, and with a margin for a perspective it never quite filled. It now fills the screen, keeping clear only of the chips along the top, and turns about the house's middle. Framed that closely, turning or tilting it by hand can run part of the house past the edge; **Fit** or going home brings it back. A real house on a 16:9 wall came out about a third larger. Only walls change; every other screen frames the house as before.
- **A wall hides Home Assistant's sidebar.** With `?kiosk=1` the map now has the whole screen. Home Assistant's own sidebar is hidden on that browser only, the same switch as **Hide HA**. **Show HA** on the Atlas page (without `?kiosk=1`) brings it back.
- Counts how a wall screen ended up drawing (`house3d_wall_draw`: every pixel, every pixel but less while moving, about 1440p's worth, or Low), once per page load, only with the usage report on.

### Fixed
- **Manage → HA Entities gave the wrong ID for the occupancy sensor.** It said `sensor.padspan_occupancy`. Home Assistant names it `sensor.padspan_occupancy_occupancy`, so use that in your automations unless you've renamed it. The sensor itself hasn't changed.
- **A wall turned by its link (`&wall_rotate=90` or `270`) used the whole screen.** The map was only as tall as the screen was before turning, leaving a large empty band beside it.

---

## 0.38.215 — The Atlas's lights list with a mouse, its hidden controls, and Vacation Mode's Options; Bright's status dot, a resumed Vacation Mode trip, and one name for the device list; Room colours, the support report's text, Day's dark boxes and Bluetooth colours, Light's checkboxes, and the 3D map's floor slabs; The menu at every window size; phone screens that fit (2026-11-01)

### Fixed
- **A mouse click on a light's ⋯, Hide or Show in the Atlas's list no longer switches the light.** The click landed on the row, so the control did nothing and the real light turned on or off. Touch wasn't affected.
- **Hiding the Atlas's controls can be undone.** The › button that brings them back was hidden with them, so only a reload worked, on a wall screen too. It now stays at the map's corner.
- **Vacation Mode's Options box scrolls.** On screens up to about 900 px high, it wrapped into side columns and hid Evening lights and the preview. On a phone it no longer squeezes into half the screen.
- **The Show button on a hidden light is easier to see.**
- **PadSpan Bright no longer shows a permanent red "Something is broken" with no Bluetooth.** Bright has no Receivers screen and works without Bluetooth, so the top bar's status dot leaves receivers out there. It still says when PadSpan isn't answering.
- **Turning a trip from before the Routine from choice back on keeps its routine.** The new default counted as a change, so it tried to learn the trip again. Nobody chose against that routine, so it carries on as the monthly average it is. A choice you make yourself still applies.
- **One name for the device list.** The Overview's list is titled All objects, like its button, and pointers to the old Objects screen now say Devices.
- **The release notes point to Settings → Tracking → Help improve PadSpan** (the tab was renamed in 0.38.202).
- **Rooms are no longer filled solid black.** Library thumbnails and the 3D Stack alignment overlay drew every room with an automatic colour as a black shape that hid the plan under it (white in Light). They now show the see-through room colour that was intended. Sandbox's Signal Pulse rings and Floor Towers, Monitor's Dashboard Card Preview tiles and the room badges in Beacon Tune had lost their tint and outline the same way. A room whose colour you picked yourself looks as it always did.
- **The support report can be read.** The text box in Diagnostics and in Monitor → Export for support was black on near-black in Night and pale on pale in Light, just when the screen asks you to look the report over before sending it.
- **Day theme: dark text on dark boxes.** Mapping's Edit card now follows the Day theme, with only the map itself staying dark, so "Edit: <map>", receiver names and the tools can all be read, from Setup too. Boxes that stay dark around a drawing, such as the floor titles in Calibration → Model and "Room Activity" in Busy Times, now keep light text.
- **Day theme: Bluetooth's coloured words can be read.** KPI numbers, signal values, chips, links and buttons on every Bluetooth tab were pale on pale. They keep their colours, darkened.
- **Light theme: an empty checkbox no longer looks ticked.** Unticked boxes were solid black squares. They are now white boxes, and ticked ones green, as in Night.
- **The 3D map's floors no longer hang dark shafts over the floors below.** With floor levels that aren't simply 0, 1, 2 and so on, which includes the sample house, each floor was drawn about a storey deep and hid the rooms underneath, on the Overview and in the Live Tracker. Homes with a lowest floor at 0 draw exactly as before.
- **The date pickers' calendar icon shows on dark fields.** It was black on near-black in Forensics, Traceback's custom range and everywhere else a date is picked, in Night and in Light.
- **No menu in a window 901 to 1100 px wide.** On an iPad in landscape, or a browser at half a screen, the sidebar was hidden and nothing on screen could open it, so you stayed on the screen you were on. These windows now get the top bar with its menu button. In both looks.
- **Devices → By Room on a phone.** Words ran one letter per line and the two filters shrank to bare arrows. The table now keeps whole words and scrolls sideways, and the filters show their text.
- **Mapping's floor tables and Manage → Data on a phone.** The same letter-by-letter breaking ("Delet/e"). Those tables now scroll sideways too, and a button no longer breaks in the middle of a word anywhere in a card.
- **Presence → BLE Objects by Scanner on a phone.** Three squeezed columns are now one, with readable names and buttons.
- **Bluetooth → Advertisements and Scanners on a phone.** The panels ran off the screen with no way to reach the rest. They now fit, and everything in a row can be read.
- **Health check rows on a phone.** The value box squeezed the name to a sliver. The value now sits under the name.
- **Point Align's preview.** On a tall floor plan the bottom of the preview could not be reached. It now scrolls.
- **Sidebar labels in the 2025 look.** The tails of g, p and y were cut off.
- **The strip above the top bar on a phone.** In the 2025 look, page content showed through a narrow gap above the bar as you scrolled. The bar now sits at the very top.

---

## 0.38.214 — Help loads visibly in German, French and Dutch; Point Align errors in metres (2026-10-31)

### Changed
- **The first "?" in German, French or Dutch opens at once.** It used to wait up to 2 seconds with nothing on screen while the translated help downloaded. Now the help window opens straight away with "Loading help…" and fills in when the translation arrives (or in English after 2 seconds, as before). If the translation arrives after that, the open help switches to it.
- **Point Align gives its errors in metres.** The preview's residual, each point's chip ("Pt 1: …"), the "high error" tip and the "Aligned" and "Baked" messages read a percentage of the reference picture's width and height, which said nothing you could check. They now say how far, in metres, the points are from where the fit puts them. The rating (Excellent, Fair or Poor) and the colours are the same as before, and a line under the points says, in metres, where Excellent and Fair end for that plan.

### Fixed
- **A translated help that failed to download is tried again.** When the download failed (offline, or the file was missing), the help stayed in English until the page was reloaded. Now a "?" a minute or more later tries again.
- **The Events log page has its own help.** Its "?" opened the help for Manage → Events, the room-change alerts, which is a different page. It now explains the log: screens you opened, live data updates and tagging since the page opened, gone on reload. In German, French and Dutch too.

---

## 0.38.213 — Small fixes found while rewriting the help (2026-10-31)

### Fixed
- **Manage → Events no longer shows a room log that never filled.** Its "Room Transitions" list read a session log nothing has written since Follow moved onto the saved movement history, so it always said "No events recorded yet". In its place is a line and an "Open History" button that opens History → Movement, where the saved room changes are. The help says so.
- **Health → Live Discovery counts the sample house's receivers.** In Sample mode "Radios" read 0. Live was already right.
- **Diagnostics lists your devices again.** It counted the sections of the live data as if they were devices, so the report said something like "0 devices" and listed none. It now lists your own devices seen in the last 24 hours: the ones you named, the ones linked to Home Assistant, and phones PadSpan knows by their key. Other devices nearby are left out. The screen and the help say the report names your rooms, floor plans and devices with their Bluetooth addresses, so look it over before you send it.
- **Support reports leave out phones' identity keys.** A phone PadSpan recognises by its identity key (IRK) was listed under that key in Monitor → Export for support. Whoever has the key can follow the phone, and these reports are meant to be sent, sometimes to a public GitHub issue. Export for support and Diagnostics now put "irk:hidden-1", "irk:hidden-2" and so on in its place, the same stand-in for the same phone throughout the report.
- **Bluetooth → Scanners' RSSI offset takes −20 to +20 dB, like Settings → Tracking → Receivers and the Receivers page.** It took −30 to +30. An offset you already saved outside that range is shown as it is and isn't changed unless you type a new one.
- **Settings → Tracking → Receivers and the Receivers page no longer cut a saved signal adjustment to ±20 dB.** 1 m Reference Calibration can save an adjustment past ±20 dB. Pressing Save on that receiver's row in either place cut it to ±20, even when you hadn't changed the number. Now an adjustment you haven't changed is saved as it is, and only a number you type is held to −20 to +20, as on Bluetooth → Scanners.
- **Compare Maps no longer stops when a shown plan has rooms but no placement.** It showed nothing at all. The placed plans are compared, and the others are named underneath as not placed yet.
- **Compare Maps gives its errors in metres.** It gave them as a percentage of an internal unit it never named. The ratings are the same as before, and a line under the result says, in metres, where Excellent, Good and Fair end for your house.

---

## 0.38.212 — The maker lookup trusts ESPHome only from 2022.12; Factory Reset erases what it learned (2026-10-31)

### Fixed
- **0.38.211 could send the first three bytes of random addresses heard by an ESPHome proxy older than 2022.12**, never a whole address. Those proxies send no address type, and the missing value reads as "fixed", so every address they heard was taken as confirmed. PadSpan now trusts an ESPHome proxy only when its firmware is 2022.12 or newer, and drops the list 0.38.211 kept. The rule: It sends only the first three bytes of an address, and only after a Bluetooth receiver has confirmed that the device has a fixed, maker-assigned address (ESPHome proxies on version 2022.12 or newer and Home Assistant's own Bluetooth say so, and PadSpan remembers it; Shelly, ESPresense and Tasmota don't, so a device only they have heard isn't looked up).
- **Factory Reset now erases what the maker lookup learned:** the addresses confirmed as fixed and the makers kept for 30 days. They outlived a reset, though the help says it erases all of PadSpan's data.
- When a receiver reports a confirmed address as random, that is saved at once, so a power cut can't bring the old confirmation back.

---

## 0.38.211 — The maker lookup asks only about addresses a receiver confirms are fixed (2026-10-31)

### Fixed
- **0.38.207 to 0.38.210 could still send the first three bytes of some random addresses** to macvendors.com and maclookup.app in edge cases, never a whole address. They let an address's own bits decide when no receiver had said what kind of address it was: for a device heard only by Shelly, ESPresense or Tasmota, or one PadSpan had stopped hearing for a while, or after a restart. 0.38.210 said it sent nothing for rows no longer heard live; it still could when one of those receivers heard them again.
- **This version sends nothing unless the address is confirmed public.** It sends only the first three bytes of an address, and only for devices a Bluetooth receiver confirms have a fixed, maker-assigned address (ESPHome proxies and Home Assistant's own Bluetooth say so; Shelly, ESPresense and Tasmota don't, so devices only they hear aren't looked up). A confirmed address is remembered, across restarts too. Any other device shows the answer already kept for its first three bytes, if there is one, or says "random address" or "maker unknown (receiver doesn't say)". The 5-minute rule from 0.38.210 is gone: a confirmed address is looked up however long ago it was heard.

---

## 0.38.210 — The maker lookup asks only about devices heard right now (2026-10-31)

### Fixed
- **0.38.208 could still send the first three bytes of a random address for rows no longer heard live.** The Objects list also shows devices from its history (kept for days, tagged ones for good, and across restarts), and PadSpan forgets what the radios said about an address when it stops hearing it for a while, or restarts. For those rows only the address's own bits were left to decide. This version sends nothing for them: only devices heard in the last 5 minutes are asked about. Any other row shows the answer already kept for its first three bytes, if there is one, or "not heard recently".

---

## 0.38.209 — Help brought up to date across PadSpan (2026-10-31)

### Changed
- **Every screen's help now matches the screen.** Overview, Follow, Devices, phone tracking, Mapping, the Atlas, Settings, Manage, Health, Bluetooth, Calibration, Traceback, Rooms, Setup and the expert tools were rewritten against what they show today: buttons named as they read, where each thing is in Basic, Advanced and Development mode, and pointers to tabs that moved brought up to date, in the help and on screen (Objects is now Devices → By Room, Maps is Mapping, Settings → Presence is Settings → Tracking).
- **More "?" buttons.** Health, the Rooms and Setup screens, each Settings → Tracking section, Calibration's Results, Guided calibration and Walk a room, Guests, wall screens, the Live Tracker and the Live/Sample and Basic/Advanced/Dev buttons all have help where they had none. Vacation Mode and Live Aboard have theirs in Mapping → Atlas; the sidebar Atlas's help is in Training. Training's walkthroughs and manual were rewritten to match, each subject told once, and the manual now explains the status dot in the top bar.
- **The translated help (German, French, Dutch) loads when it is first opened.** It used to be fetched every time the panel opened; now it comes with the first "?" or the first visit to Training. English loads nothing extra, as before.
- **The map-deletion help was wrong.** It said a deleted map's calibration points could be used again by uploading the map again. They can't be put back on a map. Deleting a map removes its picture and the room outlines and receiver and beacon pins drawn on it; the saved layout in metres (Mapping → Layout) stays, and so do the map's calibration points that have a position in metres, on no map and still used for positioning. To remove those points too, use that map's Clear in Settings → Scanner Map first: it deletes the map's calibration points.
- **The ESPresense Companion import only adds.** Its help said it updates rooms you already have; it adds new ones and leaves yours alone.
- **Home Assistant entity names shown as they really are.** Manage → HA Entities and the help showed IDs like sensor.padspan_car_keys_area; a named device's entities are device_tracker.car_keys, sensor.car_keys_area, sensor.car_keys_distance and one sensor.car_keys_distance_… per receiver. The ready-to-paste templates there now find PadSpan's sensors by integration and skip the per-receiver distance sensors (a receiver whose name ends in "area" used to slip in), so they work as written.
- **Where to send a support report.** Diagnostics, Monitor → Export for support, Health and the help now say where: email it to hello@traks.ca, or attach it to a GitHub issue, which is public, so remove personal details first.
- **The top bar stays on one row.** Where PadSpan's menu and Home Assistant's docked sidebar leave it short of room (a window about 1100–1280 px wide), the two "?" beside Live/Sample and the mode button step aside (both topics are in Training) and a long badge shortens instead of wrapping.
- **Smaller corrections:** the Atlas builder's tour no longer says placing lights is free (it needs a PadSpan Bright Pro or PadSpan Pro key) and lists today's device chips; reading photos with no AI Task set up points to Settings → AI; the reference-power advice was the wrong way round; the Factory Reset help lists what a reset keeps; and the privacy help now explains the device maker lookup (on by default; it sends only the maker part of an address to macvendors.com and maclookup.app, and an administrator can turn it off).

### Fixed
- **Beacon Tune's hard relocation keeps the points you collected by carrying the device.** Moving a beacon three times in a few minutes and choosing to replace its old data deleted every calibration point that named that device, including the ones collected by carrying it in Pin & Listen, Roam or Walk a room. Beacon Tune now marks its own points, and a hard relocation deletes only that beacon's earlier Beacon Tune points and its automatic [auto] points. Beacon Tune points saved by an older version aren't marked, so they are kept too.

---

## 0.38.208 — The maker lookup never sends a known random address (2026-10-31)

### Fixed
- **0.38.207 could still send the first three bytes of some random addresses** to macvendors.com and maclookup.app, for up to 30 seconds after an advert from Home Assistant's own Bluetooth adapter (up to 60 if the Bluetooth refresh interval was raised). Those adverts don't say whether an address is random, and each one wiped what BlueZ had said until PadSpan read it again. This version fixes it: once a radio has said an address is random, PadSpan keeps that for as long as it keeps the address, and for an address it has no type for yet, it asks the radios before anything is sent. Whole addresses were never sent.
- **The Objects list shows each address's own maker.** It kept answers by their first three bytes, so a random address could show the maker of another device with the same first three bytes (nothing was sent for it). A random address now always says "random address", and so does a private BLE row.
- **With the lookup off, every Bluetooth row says "Lookup off"**, iBeacon and private BLE rows included.

---

## 0.38.207 — The device maker lookup sends the first three bytes only (2026-10-31)

### Changed
- **The maker lookup no longer sends whole Bluetooth addresses.** Opening the Objects list asks macvendors.com and maclookup.app which company made each nearby device. It now sends the first three bytes of an address only (such as `AA:BB:CC`), never the whole address, and never an address known to be random or locally administered, the kind phones use. When a Bluetooth proxy reports an address as random (ESPHome proxies and BlueZ do), it is never sent; when the type isn't reported, the address's own bits decide. The list says "random address" for those.
- **Only an administrator can turn it off or on:** Settings → Tracking → Privacy, updates and feedback → Look up device makers online, or the switch at the top of the Objects list. It stays on by default, so nothing changes for anyone who uses it, except what is sent.
- With the lookup off, every Bluetooth row in the Objects list says so.
- The usage report (opt-in) says whether the lookup is on, as a yes or no only.

---

## 0.38.206 — Quicker photo reads; Vacation Mode replays last week (2026-10-31)

### Changed
- **Photo reads are quicker.** A furniture photo with no kind picked now gets a quick look first (only "what is it?"), then that kind's own questions. When the quick look isn't sure (no answer, "other", or words that name no kind), or that kind's answer can't be used, the full read runs as before. In testing with a local vision model, a furniture photo took about 21-24 s instead of 32-35 s, and the quick look named the same kind as the full read on all 9 test photos.
- **A photo read has one time limit as a whole: 8 minutes,** the most two reads could take before. Each read still gets at most 4 minutes. A later read gets only the time that's left, and with too little left the answer so far stands. A normal read takes well under a minute.
- **Photos are sent at 1024 px instead of 1280.** The AI reads them faster, and nothing it is asked (what it is, colours, rough sizes, a figure for a person) needs the finer detail.
- **Vacation Mode now replays last week by default.** Each day plays like the same day last week: a Tuesday turns lights on and off the way they went last Tuesday, half hour by half hour. A half hour a light was on for only part of becomes that chance each night. If that day falls inside an earlier vacation or has no history, it uses the same weekday a week earlier, then the monthly average. The intensity slider still scales it.
- **A "Monthly average" choice.** In Vacation Mode's Options, "Routine from" has two buttons: Last week, or Monthly average (each weekday from the last month's average, the way Vacation Mode worked before). The choice is used when Vacation Mode is turned on. A trip that's already running keeps its routine, and a change applies the next time you turn it on. Turned back on within 3 weeks with the other choice, a trip is learned again from the days before it began, if Home Assistant's history still holds the week before; if not, it keeps the routine it had.
- **Evening lights follow when they were really on, not sunset.** Each evening light stays on over the stretch it was actually on that evening (between 4 pm and 5 am): last week's same day, or the usual start and end time for that weekday on the monthly average. The times move up to 10 minutes each night. A light that wasn't on that evening isn't held. Bedtime still turns them off, and they no longer need Home Assistant's sun times. "Only after dark" is unchanged.
- A trip that was already running when you update keeps its routine exactly as it was. Its evening lights follow that routine like the other lights until Vacation Mode is next turned on.
- The preview says which routine it plays ("From last week" or "From the monthly average"). `binary_sensor.padspan_vacation_mode` has a new `source` attribute.

### Opt-in report
- `photo_quick:ok` and `photo_quick:fallback`: whether the quick look was enough or the full read had to run, once per furniture photo with no kind picked. Neither is counted when the read fails. Never the photo or the answer.
- The Vacation Mode section says which choice is set: `last_week` or `month`. Nothing else changed.

---

## 0.38.205 — A backup AI Task; The Atlas keeps its map card between updates (2026-10-30)

### New
- **A backup AI Task.** Settings → AI has a new Backup AI task picker under the main one. When the main AI Task can't be reached (for example, it runs on a laptop that's out of the house), photo and floor-plan stair reads switch to the backup on their own, so you never have to change the setting by hand. PadSpan only switches when the main one is really away: Home Assistant shows it as unavailable, its server doesn't take a connection within 5 seconds, or the call fails because the server can't be reached. A main AI Task that is just slow, or that gives an answer PadSpan can't use, is never switched. Once the main one has failed, PadSpan skips it for 5 minutes and then tries it again. A read done by the backup says so ("Read by the backup AI task"), and before you send a photo, the photo step says which AI Task will read it and whether the backup, if it reads instead, keeps the photo in the house or sends it to the cloud. There's no backup until you choose one, so nothing changes for anyone who doesn't.

### Changed
- **The sidebar Atlas keeps its map card between updates.** Each update used to build the map's card again whole: its controls, floor chips, legend and the stage with the rain, people and Live Aboard on it. Now the card stays on screen and only what changed is redrawn: the floor and type chips when their counts change, and the parts of the map that changed. An update takes about 45% less time at 1080p and on a 4K wall. Changing a setting, the floor, the spacing, the layout or the map still builds the card fresh, as before. The rain is no longer set up again on every update.
- **Whole house's "Yes, change the whole house" goes back to Apply after 10 seconds.** The next update used to reset it; now that the card stays, a timer does, so a confirm is never left waiting on a wall screen for a stray tap. The same for "Yes, turn on Vacation Mode".

### Opt-in report
- Two new counts: reads done by the backup AI Task because the main one was away, and reads where the backup failed too. The report also says whether a backup AI Task is set (yes only, never which one).

---

## 0.38.204 — The Atlas keeps its lights list between updates; Rooms page in PadSpan Bright; Fewer screens that repeat another one; in Basic, a link opens just the part it is about; Clearer names: Layout and Build; Preview a finished house: the three-storey sample house (2026-10-30)

### New
- **PadSpan Bright gets the Rooms page: each room's colour, outline, ceiling height, split level and lights, in one place.** The lights are counted the way the Atlas counts them (hidden lights left out), with how many are on now. Receivers and who is in a room stay on the PadSpan HA page only (and in Bright only while its presence screens are revealed). The "All rooms" buttons in Mapping → Edit, Mapping → Layout and Settings → Appearance now show in Bright too. In Sample mode it shows the sample house's rooms and lights, and nothing can be changed. Nothing changes on PadSpan HA's Rooms page.

### Changed
- **The sidebar Atlas no longer rebuilds its lights list every 5 seconds.** The list under the map stays on screen, and only the rows whose light, sensor or reading changed are redrawn. Changing the filter, the sort, hiding a light, a setting or a new map still redraws the list whole. It looks and works exactly as before, and each update takes about a third of the time it did on a desk screen (a wall screen gains less, as it does not show the list). Scrolling the list sideways is no longer reset by an update.
- **Monitor → Quick status points to Health.** It showed part of the Health page (version, what PadSpan found, problems found). The tab now says so and has an Open Health button; Health has all of it and more.
- **Manage → History points to the History screen.** It showed the same saved room changes as History → Movement, which also tells a first sighting from a room change, filters them and jumps to Traceback. The tab now has an Open History button. Manage → Events stays as it was: its alerts editor and the session's room changes aren't on the Events screen.
- **The Live Aboard setup wizard no longer repeats Settings.** The first time you set up Live Aboard, the wizard still has the switches (quality, rain and snow, back to home view, the shared furniture library, furniture from a photo, the Atlas as Overview), so you can do it all in one place. After that, each one shows what it is set to, with a button to the Settings tab where you change it.
- **In Basic, a link opens just the part it is about.** Before, it landed on Appearance or the Library, or switched you to Advanced. Now it opens only that part, with one "← Back" to where you were, and you stay in Basic: the Rooms page's Edit outline opens the map editor with just the room-drawing tool on that room; the Receivers page's Place or Move opens it with just the receiver tool on that receiver, its height included; the floor-heights tips (Overview, Calibration's Results, Setup's Floors step) open just the Floor Heights card; the usage report, Guests' Open Settings and the tester sign-up open just their card (Settings in Basic has a Usage report and a Guest tags button for them). Mapping's Open, in Basic, opens the plan in the setup wizard, where each step (scale, rooms, scanners) shows only its own tool. Advanced and Development open the whole tab, as before.
- **Basic no longer links to installer screens.** In Basic, the calibration guide's last step has no button to the QA report, Manage's Bluetooth refresh note has no button to Settings → Tracking, Live Aboard's settings have no Open Live Aboard (the builder), and the Atlas has no ✎ Edit map at the top nor a ✎ on a light's card to the builder. The screens are still under More tools.
- **Mapping's Rooms tab is now Layout.** It shows the room and receiver layout in metres, and shared its name with the Rooms page in the menu. It works as before; only its name changed, here and in Help, Training and the guides. Mapping → Edit's Rooms drawing mode keeps its name.
- **The menu's Setup group is now Build.** It held the same name as the guided Setup (one step after another), which keeps its name. The screens in the group are the same.
- **Help's editions section in German, French and Dutch.** The page on Free, Bright, Bright Pro and Pro was the last part of Help still in English in those languages.
- **Preview a finished house now shows a three-storey sample house with stairs, split levels, lights, people and calibration, the same one as the website demo.** Sample mode used to show a small one-floor house of five rooms, and only on some screens: the rest showed your own rooms with demo people in them. Now every screen of the PadSpan panel shows the sample house: the Overview, the Live Tracker, Follow, Mapping, Rooms, Receivers, Calibration and its results, Health, the Atlas inside the panel and the guided Setup, which shows every step done. The Atlas page in Home Assistant's sidebar stays on your own house. Nothing in the sample house can be changed and nothing is saved to your Home Assistant, though you can still change the theme and look. Nothing from it is counted in the usage report, apart from opening the preview and going back. A real flood alarm still shows while you look at the sample house, with a button back to your own house to reset it. "Back to my house" brings your own house straight back, and the sample house is only downloaded when you open the preview.
- **The preview is for this screen only.** Turning on Sample mode on one phone or computer no longer turns every other screen in the house to the sample house (a wall display stays on your own house). Each browser remembers its own choice. A house that was left in Sample mode before this update opens in Sample mode until someone presses "Back to my house".

### Fixed
- **Holding a light to dim it is no longer cut short by an update.** If the 5-second update landed while you were holding a light on the map and sliding to dim it, the dim stopped. Updates now wait until you let go, as they already did for sliders.

---

## 0.38.203 — Calibration opens on its results; One guided Setup; A Receivers page: every Bluetooth receiver in one table; A Rooms page (2026-10-30)

### New
- **Setup, one step after another.** Setting up a house is now one list in order: upload a floor plan, set its scale, give the floors their heights, draw the rooms, place the receivers and say how high each is, then calibrate. Each step says whether it's done, next, still to do or skipped, and opens the tool that already does it (the Mapping Setup Wizard at that step, Mapping → 3D Stack's Floor Heights, or the guided calibration). A bar over that tool shows which step you're on and leads back to Setup.
- **Skip a step and come back later.** Setup remembers the step you were on and the ones you skipped, so it picks up where you left off, on any screen. Whether a step is done comes from your house itself: a plan uploaded, a distance measured, a floor given a height (a one-floor house has nothing to set), a room drawn, receivers placed and not all at one height in a house of two floors or more, and five calibration points or a computed model.
- **Where to find it.** "Open Setup" on the Overview's Getting started card, a Setup button beside Refresh on Mapping, and "Make it a map" on a new install's Who's where. With no floor plan yet, Mapping's "Start Setup Wizard" is Setup's first step: the same wizard, with the bar back to Setup (and no second Setup button above it). The Getting started steps still go straight to their tool, now with the bar back to Setup. The Mapping Setup Wizard and Guided calibration are still where they were, and Mapping's and Calibration's tabs are unchanged.
- **Setup is about your own house.** While the demo house is showing (Sample mode), Setup says so, its step buttons wait for your own house, and nothing is stored or counted.
- **Receivers, a new screen in the menu's Setup group, in every mode.** One row for each Bluetooth receiver PadSpan hears from: its room, its floor, whether it is on a floor plan, its height, its signal adjustment, its status, how many devices it hears right now, and when it was last heard. Until now these were spread over Mapping, Calibration, Settings, Health and Bluetooth. In Basic mode it is in the main list, beside Calibration: every home has receivers, and a silent one is the commonest reason a room is wrong.
- **Height and signal adjustment can be changed right in the table.** They are the same values as Calibration → Tune, Mapping → Edit → Radios and Settings → Tracking → Receivers, saved the same way: change one in any place and the others show the new number. Nothing new is stored.
- **Status uses the top bar dot's rules:** Online, Silent (not heard for over 10 minutes, with how long; never one that is scanning or heard just now), Hearing less (far fewer devices than usual while the others are normal), or Not in use (marked lost, disabled or excluded, which the dot leaves out too). Problem rows are marked; tick **Problems only** to see just those. Click a column heading to sort by it.
- **Place or Move** opens Mapping with that receiver selected (in Basic, the floor plan setup's Place scanners step), to put it where it is mounted. Positions and calibration are never changed from this page.
- In Sample mode the demo house's receivers are shown read-only, with a note. On a phone each receiver is a card.
- Mapping → Edit → Radios, Settings → Tracking → Receivers, Health's Scanner Health and Bluetooth → Receivers keep their controls and gain an **All receivers** link to the new page.
- **Rooms, one page for every room.** A new Rooms screen in the menu's Setup group, in every mode (Basic included: Basic's Mapping has no Edit or Rooms tab, so this is its only room-by-room screen). Each room is listed under its floor, with its colour, whether its outline is drawn (and its size in m² when it is), its ceiling height, its split level, how many receivers are in it and who is in it now.
- **Edit in place.** The colour, the ceiling height and the split level save right there, the same way Settings → Appearance and Mapping → Rooms save them, so all three screens always show the same values. Nothing new is stored.
- **Rooms are still your Home Assistant Areas.** Names and floors come from Home Assistant: "Rename in Home Assistant" and "Add a room in Home Assistant" open its Areas page, and Refresh reads the change back. A room drawn only in PadSpan's layout is listed too, marked as not an area.
- **Edit outline** opens Mapping → Edit on the floor plan the room is drawn on, with the Rooms tool on and that room chosen. In Basic it switches to Advanced first and says so, as Mapping's own Open does. **See receivers** opens the receiver list.
- Settings → Appearance's Rooms card, Mapping → Rooms and Mapping → Edit's Rooms tool each have a small **All rooms** link to the new page. They keep their own controls.
- In Sample mode your own rooms are listed read-only, with a note, and without the demo house's people in them.

### Changed
- **Calibration opens on a new Results tab.** It answers the two questions people come with: how accurate is it, and how do I make it better.
  - **How accurate it is now:** rooms right and the typical distance off, tested on spots it hasn't seen (the same score Model and QA show), with how many calibration points you have. Before that score has run, the older estimate is shown and said to be an estimate.
  - **Room by room:** the rooms that need work come first (no points yet, the ones most often mixed up with another room, the ones with only a few points). Rooms that look fine fold away under one line.
  - **The next best thing to do:** one step, with a button that goes to the right place. In order: give a floor plan a real-world scale, start calibrating, set receiver heights, set floor heights, work the accuracy out again after new points, add points in a room with none, add points in the weakest room, or walk the house again when the newest point is over 90 days old. With nothing to fix, it points to Accuracy by spot. Floor heights are in Advanced mode, so from Basic that button switches to Advanced and says so, as the Overview's floor-heights tip does.
  - **Guided calibration** is the main button. Leaving the guide brings you back to Results.
- A new house with no calibration points sees two lines about what calibration does and the Guided calibration button.
- In Sample mode, Results shows the sample house's made-up results. Nothing on Results saves or changes anything; calibration points are only read.
- Every other tab is still there, with the same name, in the tab bar. A tab you pick is kept while the page stays open. Links like `?view=calibration&tab=tune` open that tab, and the Overview's receiver-heights tip and Mapping's "Go to Calibration" open their tabs even when Calibration hadn't been opened yet.
- **Getting started's "Calibrate" means calibrated.** It used to tick as soon as receivers were placed in the layout, which is its own step (Place Scanners). Now it needs five calibration points or a computed model, the same as Setup's Calibrate step. A house whose Getting started was already finished or skipped doesn't see the card again.

### Opt-in report
- With the usage report on: how often Calibration's Results tab is opened, and which of its buttons is used (the kind of step, such as "set receiver heights" or "Guided calibration"; never a room). Not counted in Sample mode.
- **How far people get through Setup:** each step reached, each step skipped, and Setup finished (once per install, and only for a house that used it). Counts only, by step name, so the developer can see where people stop.
- Opening the page is counted like every other screen (`tab:receivers`), and a height or signal adjustment saved from its table is counted once per save (`receivers_page_edit`). Never which receiver or the value.
- Opening the Rooms page is counted like every other screen (from the menu or an All rooms link), and each colour, ceiling height or split level saved on it is counted (only that it happened, never the room or the value).

---

## 0.38.202 — Calibration in Basic mode; Pure Live is now Live Tracker; Every screen in every mode, with More tools; Plain names for expert words; Receiver height in Edit → Radios; Settings: an Atlas tab, and plainer names; Settings in sections; A status dot in the top bar (2026-10-30)

### New
- **A status dot in the top bar says when something is wrong.** When all is well there is nothing there. A red dot with a round "!" means something is broken: PadSpan isn't answering, positioning's last update failed, or no Bluetooth receiver is reporting. An amber dot with a triangle means something needs attention: a receiver not heard from in over 10 minutes, one hearing far fewer devices than usual, or learning suspended. A receiver you marked lost, disabled or excluded on the Bluetooth screen isn't counted, and one the Bluetooth screen shows as scanning or listening is never "not heard from". The number beside it is how many issues there are, and hovering (or a screen reader) says what they are in plain words. Click it to open Health.
- **It doesn't blink or nag.** A problem has to be there on two polls in a row before the dot shows (red: three, about 15 seconds), and gone for two before it goes. "No receiver is reporting" waits two minutes after the panel opens or PadSpan answers again, while receivers report in. No pop-ups, no sounds, and nothing in sample mode.
- **On a wall screen, red only.** With `?kiosk=1` the top bars are hidden, so a red problem shows in the bottom-right corner instead (screen readers hear what it says); amber stays off the wall. Setup tips, scanner reliability scores and floor-plan receivers no live receiver matches aren't counted: they are advice, and stay on the Overview, in Health and in Mapping.

### Changed
- **Calibration is in Basic mode's menu.** Every home needs it for accuracy, so you no longer have to switch to Advanced to reach it. Inside, it has the same tabs as in Advanced.
- **The accuracy tip about receiver heights opens Calibration → Tune and leaves you in Basic mode.** Getting started's calibration step no longer switches you to Advanced either.
- **Mapping's "Go to Calibration" (the end of setting up a floor) leaves you in Basic mode too.**
- **Calibration's "Measure this floor" works in Basic mode.** It opens Mapping's set-up at the step where you measure one distance (in every mode, as the accuracy tip "Measure" does); in Basic it used to land on Mapping's Library.
- **The accuracy tip about floor heights says why it switches you.** Floor heights are on Mapping → 3D Stack, which Basic doesn't have, so from Basic it switches to Advanced and says so (as Mapping's Open does); it used to land on Mapping's Library.
- **Links to Settings → Tracking open it in Basic mode.** Manage's and Guests' "Open Settings" and the tester sign-up open the Tracking settings with a way back to Appearance, and the tester sign-up no longer switches you to Advanced. Basic's Settings also has an "Open Tracking" button, so the usage report, guest tags and receiver settings the messages point to are there in every mode.
- **The Training help now says Calibration is in every mode.**
- Pure Live is now called Live Tracker. Links and settings are unchanged.
- **Modes no longer hide screens.** Every screen is in the menu in Basic, Advanced and Development. The everyday screens stay in the main list; the rest (Devices, Bluetooth, Presence, Monitor, QA, Sandbox, Install Base) are in a new **More tools** group at the bottom of the menu. It starts closed, and PadSpan remembers whether you left it open. Many homes were switching to Development just to reach Devices or Bluetooth: now they can open them from any mode, and opening one never changes the mode.
- **Basic stays short.** Basic's main list is still Follow, Overview, Mapping, Calibration, Settings and Training; Live Tracker, Occupancy, Manage, Traceback and Health join the other screens under More tools.
- **Advanced and Development share one menu.** The modes now change only how much detail each screen shows. Settings → UI Structure still moves Devices, Bluetooth, Presence, Monitor, QA or Sandbox into the main list (in Advanced and Development).
- **On a phone**, More tools is in the menu that the bottom bar's More button opens.
- A link that opens a screen directly (`?view=devices`) opens it in every mode, as before.
- **Screens and buttons use plain names now.** Nothing moved and nothing else changed; only the words:
  - Monitor's tabs: Diagnostics → Calls and timing, Insights → Signal and coverage, Health → Quick status, Diag Export → Export for support
  - Manage → HA Entities: Insights → Tips
  - Calibration: Setup → Beacon and floor, Error Matrix → Accuracy by spot, Path-Loss Fits → Signal vs distance, Save Z → Save height
  - Positioning Fabric → Room and receiver layout (Fabric Status → Layout status, Room Fabric by Floor → Room layout by floor, Load into Fabric editor → Load into the layout editor, Refresh Fabric → Refresh layout)
  - System Critics → Problems found, Refresh Critics → Check again, Room Confusion Matrix → Room mix-ups
  - k-NN / Random Forest → Matched to calibration points / Learned model (hover the status line for the method's own name)
  - Mapping → Edit: RF Barriers → Signal walls
  - Atlas: Isolux → Light spread
  - Overview: Live EMA sources → Live signal sources; the Distortion buttons on the Overview and floor plans → Signal distortion
- **Two error messages point to the right place.** A failed data-mode switch now says the details are in the browser console, and failed auto diagnostics point to Monitor → Export for support.
- **A receiver's height can now be set in Mapping → Edit → Radios.** Select a placed radio and its height above the floor (in metres) shows under its room, with a **Save height** button. It is the same height as Calibration → Tune's Save height: saving it in either place changes the one stored value, and the other place shows the new number. Only the height is saved; the radio's position and calibration are left as they are. A radio that has no position yet says so instead of showing the box.
- **The Atlas has its own Settings tab.** Everything about the Atlas and Live Aboard (the sidebar Atlas, what it draws, outdoor weather, Live Aboard, wall screens and the Atlas as Overview) moved from Settings → UI Structure to a new Settings → Atlas tab, unchanged. UI Structure keeps the menu and edition settings and points to the new tab.
- **Show people and Show tags & scanners have one switch.** While Live Aboard is on, you switch them in Live Aboard's Views menu, and Settings → Atlas shows whether they are on, with a button to open Live Aboard. While Live Aboard is off they are switched in Settings → Atlas, because they still show on the flat map.
- **Live Aboard's look is chosen in Settings → Atlas.** The setup wizard shows the current look and opens Settings → Atlas. A first setup doesn't need to pick one: "Same as the Atlas" is the default.
- **Plainer names in Settings.** The Presence tab is now called Tracking (the Presence page in the menu keeps its name). "Fabric source" is now "Room and receiver layout source". The positioning choices are "Matched to calibration points" and "Learned model", with the technical names on hover. "Signal Filter" is now "Signal smoothing", "BLE Reseed Interval" is now "Bluetooth refresh interval", "Scanner RSSI Offsets" is now "Receiver signal adjustments", and "Distortion Map" is now "Signal distortion map". Only the words changed; every setting works as before.
- **Settings → Tracking is in sections.** Its thirty-odd cards now sit under eight headings: Rooms and timing, Phones and guest tags, What the panel shows, Positioning and calibration, Receivers, Performance, Home Assistant and integrations, and Privacy, updates and feedback. Click a heading to fold it away; this browser remembers which ones you folded. Every section starts open, and no setting or default changed; the one card whose text changed is Quiet mode (below).
- **Quiet mode is switched in one place: the Quiet tick at the top of the Overview.** Its card in Settings still explains it, shows whether it is on, and opens the Overview (the classic Overview when the Atlas is your Overview).
- **"Aggressive BLE reseed (5s)" moved next to the Bluetooth refresh interval it shortens**, in Settings → Tracking → Receivers. Manage → HA Entities → BLE Proxy Compatibility now says whether it is on and opens that section, in Basic mode too.

### Opt-in report
- Opening More tools is counted (only the opening, not closing), to see whether people find it.
- **Whether the dot gets looked at:** a count of clicks from the status dot through to Health (`status_dot_open`). Never what the dot said.

---

## 0.38.201 — The Atlas redraws only what changed; Stopping a calibration capture early; Vacation Mode: evening lights, a limit on lights at once, and a preview (2026-10-30)

### New
- **Evening lights.** In Vacation Mode's Options you can tick up to 10 lights, like a porch or hall light, to stay on from dark until your bedtime (about 11 pm if no bedtime is set, give or take 20 minutes each night). Dark follows the after-dark offset and needs Home Assistant's sun times. If one is turned off during the evening, it comes back on within 5 minutes, like the routine's lights. After bedtime they follow the routine again, and one you turn on by hand then is left alone.
- **Most lights on at once.** An option to cap how many lights the routine has on at the same time. Lights it already has on stay on, and the others wait their turn. Evening lights and lights turned on by hand don't count, and the cap never turns those off.
- **Preview.** "Show the next 24 hours" in Vacation Mode's Options lists which lights it would turn on and when, using your current options. It works before you turn Vacation Mode on, and it doesn't switch or save anything.
- All three are off until you set them, and Vacation Mode works exactly as before until then. `binary_sensor.padspan_vacation_mode` now also shows `max_lights_at_once` and `anchor_lights`.

### Changed
- **The sidebar Atlas no longer redraws the whole map every 5 seconds.** Each update now keeps the floors, rooms, walls and labels it already drew and replaces only the parts that changed: a light switched, motion, a new reading. Switching floors, changing the spacing or zoom, a setting, or a new map still redraws it whole. The drawing is the same as a full redraw would make. It does a little less work on every update, which helps most on a large wall screen. The fading rings around recent motion now keep pulsing smoothly instead of starting over at every update.

### Fixed
- **Stop & Discard during a calibration capture no longer causes a hidden error.** Pressing it while PadSpan was fetching the next reading let the capture carry on into readings it had just thrown away. A Stop then a quick Start could also leave the old capture running alongside the new one, doubling its samples. Pin & Listen, Roam and Guided calibration all share this fix.

### Opt-in report
- The Vacation Mode section says yes or no for whether the light cap and evening lights are set. It never includes which lights.
- New counts: the cap holding a light off (once a day), an evening light turned on (once a day), and the preview opened, counted separately when it had nothing to show.

---

## 0.38.200 — Fewer warnings in the Home Assistant log (2026-10-29)

### Fixed
- **Reloading PadSpan no longer logs "Panel re-registration failed".** Saving PadSpan's options or pressing Reload tried to add the sidebar panel a second time, which Home Assistant refuses. PadSpan now takes its own panel down first, so the panel is refreshed and the log stays quiet.
- **The phone search in Track Your Phone no longer fails because of one phone.** A phone whose BLE Transmitter reported a Major or Minor that was not a number stopped the whole search, so no phone was listed. The other phones are now listed. That one shows as a phone whose sensor PadSpan can't use yet, with no Follow, so it can't be followed under an ID it never sends.
- **A calibration point refused on a map with no metre scale is no longer a log warning.** The Calibration tab already tells you why and what to do (measure the map first); the log only repeated it on every try. Other save failures still show in the log.
- **A device key that already belongs to another device is no longer a log warning.** PadSpan still refuses to merge the two devices, as before; it just doesn't warn about doing its job.

### Opt-in report
- Two new counters: `companion_ids_unreadable` (a phone left out of the search because its Major/Minor could not be read) and `device_identity_refused` (a device key that already belongs to another device).

---

## 0.38.199 — The stable after 0.38.166: everything from the last four days of betas (2026-10-29)

### Changed
If you're on the stable channel, this is everything from 0.38.167 to 0.38.198 in one go.

### Things you'll notice
- **Your own house first.** A new install shows who's where in your home before any floor plan is drawn, and the map wizard puts your plan in place for you.
- **Vacation Mode** can't be turned off by accident. It also has options (after dark only, an end date, pause when someone is home, bedtime, the longest a light stays on) and a status sensor, `binary_sensor.padspan_vacation_mode`.
- **Improve accuracy tips on the Overview.** If your home skips floor heights, receiver heights or a real-world scale, a small card says so and takes you to the fix. Hide one tip, or the whole card.
- **Help in Dutch, German and French.**
- **Shelly scanners** find their Shelly by its address, and get their room without a restart.
- **Calibration** tells you a floor has no real-world scale before you stand still for a capture, not after.
- **Forensics stops recording when a licence or trial ends.** What it already recorded stays searchable.

### Live Aboard (the 3D house)
- **Stairs:** open stairs, treads only, Floating stairs (open treads on one steel spine), and stairs with two or three landings. Stairs can also come from your floor plans (AI, a first guess) or from rooms named for stairs. You can also have a few steps within one floor, such as up from a sunken garage.
- **Split levels.** In Mapping → Rooms, a room's floor can sit higher or lower than the rest of its floor. Stairs climb into it, and it sits on a short wall.
- **Settings → AI** holds the AI features: furniture from a photo, and stairs from plans. All are off until you turn them on.

### Off until you turn them on
- Guest tags.
- Optimize for scale.
- Calibration's Walk a room.

### Before you roll back
- **A house with a Floating staircase needs 0.38.196 or later.** Older versions can't save its 3D file. If you go back to an older version, set those stairs to another style first.

### Room timing
- **Room Change Delay now does what it says.** A delay of 0 used to act as 20 seconds; now 0 means a person's room changes as soon as PadSpan is sure. If you set 0 and rooms now switch too eagerly, set it to 10–20 seconds in Settings → Presence.

### Usage report (if you share it)
New counts, never names or places:
- the accuracy tips
- stairs and split levels
- rooms drawn over each other
- how recent fixes act in real homes

---

## 0.38.198 — Raised rooms' doorways as high as the door (2026-10-29)

### Fixed
- **A raised room's doorway from the rest of its floor is as high as the door.** In 0.38.196 the gap in the raised room's wall ran a door's height up from the raised floor, so a room raised well above the rest of its floor showed a hole above the floor's roof. The gap now runs from the door's sill to its top, measured from the floor the door stands on, through the wall the raised room stands on. If a room is raised past the top of the door, there's no gap above its floor at all.
- **A gallery that runs along both the rest of its floor and a raised room** stays an open edge along the floor, with the rail it had, and opens the raised room's wall too. In 0.38.196 the whole edge went with the raised room, and the stretch along the floor turned into a solid wall.
- **A door at an outside corner of a raised or sunken room** goes, whole, with the room whose wall it's in. In 0.38.196 a door that started just before the room's corner (a sunken garage's side door) became a sliver of door in the house's wall beside a doorless hole in the room's.
- **A window with a contact sensor** on the wall between a raised room and the rest of its floor stays a window. No doorway is cut beside it.
- **A door or window you rename, or give another material,** is placed again straight away, even if the new word is as long as the old one.
- **Correction to 0.38.196's notes:** going back after using Floating, 0.38.183 to 0.38.195 (not just to 0.38.194) keep a floating stair and draw it Closed, but refuse a save that moves or changes it.

---

## 0.38.197 — Same as 0.38.196, with its checks passing (2026-10-29)

### Changed
- **Nothing changes in PadSpan itself.** This is 0.38.196 again: Floating stairs, and doors, windows, rails and names put right on split levels (see 0.38.196 below). One of 0.38.196's own tests had a time limit too tight for GitHub's slower machines, so its checks failed. This release passes them. If you're already on 0.38.196, you don't need it.

---

## 0.38.196 — Floating stairs; Doors and windows on split levels; A sunken room's name shows; Stairs wider than 4 m (2026-10-29)

### New
- **Floating stairs.** A staircase in the 3D house (Furnish → Build ▾ → House → Stairs) has a fourth **Style**, **Floating**: open treads on one steel spine down the middle, fixed to the floor at the bottom and to the floor or landing at the top, and nowhere on a wall. **Treads only** is still the style fixed into a wall.
  - It works with every shape (straight, L, U, two or three landings), with a few steps within a floor and with split levels. Each landing sits on the spine too.
  - **Auto** gives a floating stair a handrail on both sides, since there's no wall beside it. Both, Inside, Outside and None work as before.

### Changed
- **Imported stairs:** a staircase whose name says floating, suspended, spine or mono-stringer comes in as Floating. Cantilevered or wall-hung ones still come in as Treads only.
- **The opt-in usage report** counts floating stairs with the other styles (a count, nothing else), and the Install Base page names them.
- **A stair style from a newer version is kept.** If a later version adds another style, this one keeps it, draws it as Closed and still saves your other changes.
- **Going back to an older version after using Floating:** 0.38.183 to 0.38.195 keep a floating stair and draw it Closed, but refuse a save that moves or changes it, and the rest of that save with it; and if you edit one of its settings there, it's saved as Closed. 0.38.182 and older never checked a stair's style. Before you go back, set your floating stairs to another style.

### Fixed
- **Doors and windows go with a raised or sunken room.** In 0.38.190 a split level's doors and windows stayed on the rest of its floor: a sunken garage lost its garage doors in the 3D house and on a wall, and a raised room's windows stood loose beside it, as far below as it was raised. They're now cut into the room's own walls. A driveway, patio or deck drawn beside the room doesn't hold them back.
- **The door from a sunken room into the house** stays in the house's wall, at the top of the steps, and the sunken room's own wall now has a doorway there too, as high as the door. Before, it was solid. A door between two raised or sunken rooms on one floor opens both their walls.
- **An Open edge** (a loft or gallery) between a raised room and the rest of its floor opens the raised room's wall too, and keeps its rail where the drop needs one.
- **Doors and windows you drew in 3D** on a raised or sunken room's wall stay on it after you save. Before, they stood loose on the rest of the floor.
- **A sunken room's name and readings show with its floor.** In the 3D house, the name and temperature chip of a room sunk below the rest of its floor (a split level) were hidden by the floor it belongs to, even though that floor is open over it. Now only that floor's walls away from the room can hide them, as any wall in front would.
- **Stairs wider than 4 m are drawn as wide as they are.** The 3D house drew any staircase at most 4 m wide, but cut the opening in the floor above at its real width, so a wide L or U round a hall left a gap beside its rail. Stairs can now be up to 8 m each way, the same as the 3D file keeps, and the stairs and their opening match.

---

## 0.38.195 — The usage report's day counts are saved again (2026-10-29)

### Fixed
- **The usage report's day counts are saved, and Home Assistant no longer warns about PadSpan.** Since 0.38.177 the counts were meant to be saved every two minutes so a restart doesn't lose them. The save ran in a background thread, where Home Assistant refuses it, so nothing was saved and the log said "padspan_ha calls hass.async_create_task from a thread other than the event loop". It now runs where Home Assistant expects. A count made from a background thread is handed over the same way, and a test checks that everything PadSpan schedules runs there.

---

## 0.38.194 — Fixes from the stable review; Stairs in the usage report, and split levels that stay put (2026-10-29)

### Changed
- **Usage report (if you share it): how stairs are used, and whether they work.** Each time Live Aboard draws a house with stairs: whether every flight lands in a room on the level it reaches, or one lands in no room, or one has no floor above to reach (the same check as Furnish's warnings); whether one reaches a raised or sunken room or is a few steps within a floor; and which shapes and styles are used. The daily report also says how many stairs were imported or came from a stair room's guess, and their shapes and styles. Never where they are or which.

### Fixed
- **A device takes the room of the device it belongs to only if it is a Bluetooth scanner.** Since 0.38.176, any device with no area took its parent device's area. Now only the scanner devices Home Assistant's Bluetooth integration makes for each proxy do (as Home Assistant itself does when it sets them up). A plug behind a hub keeps having no room.
- **Calibration no longer says a floor has no scale while the house is still loading.** For a moment after the panel opened, a floor could be blocked for capture before PadSpan had read the floor plans.
- **A raised or sunken room no longer moves again when Live Aboard redraws.** Since 0.38.190, any redraw (after an edit in Furnish, for example) applied the raise a second time, so a room raised 0.75 m was drawn 1.5 m up until the page was reloaded.

---

## 0.38.193 — Accuracy tips, and a few more things in the usage report; The usage report says where recent fixes acted (2026-10-29)

### New
- **Improve accuracy tips on the Overview.** The usage reports show most multi-floor homes skip three setup steps: 39% leave every floor at the default height, 30% leave every receiver at one height, and 28% never give a floor plan a real-world scale. Once setup is done or skipped, the Overview now says which of these apply to your home, in one small card:
  - **Floor Heights** opens Mapping → 3D Stack, **Receiver heights** opens Calibration → Tune, **Measure** opens the map wizard's scale step.
  - Hide one tip with its ×, or the whole card with **Hide these tips**. It stays hidden.
  - Only administrators see it, never on a wall screen, and only when no other Overview card (what's new, an offer) is showing.
- **Usage report (if you share it):**
  - Rooms on one floor drawn over each other by more than 10 cm, a common slip that can put a device or a staircase in the wrong room. A count of pairs, never which rooms.
  - Live Aboard's stairs: how many, how many the AI read off a plan and are still there, and how many are a few steps within one floor.
  - How long the AI takes to read a floor plan, in bands.
  - Beside each time the 3D house couldn't show, how many rooms the house has (in bands), to tell a slow screen from a very big house.
  - Each accuracy tip shown, followed to its fix, or hidden.

### Changed
- **Usage report (if you share it):** three recent fixes now say when they act, so they can be checked in real homes before the next stable:
  - a Shelly's Bluetooth scanner found by the Shelly's network address (0.38.175), and a scanner given its Shelly's room (0.38.176), counted per home;
  - Forensics switched on but paused because the licence no longer reaches Pro (0.38.191);
  - the stale-receiver list in Mapping → 3D Stack opened (0.38.170).
  Counts only, never which scanner, room or receiver.

### Fixed
- **The new room-overlap count stays quick on very big houses.** It compares only rooms whose outlines come near each other: 600 rooms of 40 corners take about 20 ms.

---

## 0.38.192 — A few steps within a floor, and AI stair reads that say how sure they are (2026-10-28)

### New
- **A few steps within one floor.** Stairs used to always climb a whole floor. Now a short flight can stay on its own floor: up out of a sunken garage into the house, or up to a raised room beside it.
  - Sink the garage (or raise the room) with **Split level…** in Mapping → Rooms. Then build the stairs in the sunken room and set **Up to** → **A few steps, on (that floor)**. A flight standing in a sunken room picks this by itself.
  - It climbs exactly the difference, for example 3 risers for 0.55 m, and cuts no hole in any floor.
- **AI stairs say how far to trust them.** Stairs read off your plans are labelled **AI first guess**. If your AI Task runs on your own computer, the message after a read says that a small local model finds most staircases but often gets their shape and which way is up wrong, and that a cloud AI Task reads plans better. Settings → AI says the same beside the switch.

### Fixed
- **Where a stair goes is stored as a whole floor.** In 0.38.190 the stair sheet could store a split level's own id for where a flight goes. It now stores the floor, and a flight saved that way is read as its floor.
- **The stair sheet's "Up to" list shows whole floors only,** never a split level as if it were a floor of its own.
- **Install Base (developer view) is easier to read.** Each section folds to one line with its key figures. A new Needs attention list sits at the top, and long lists show their top few with Show all. The installs table has a filter. The page went from about 12 screens to 2.

---

## 0.38.191 — Forensics stops when a licence ends; the wall's People and Motion chips grow on 4K (2026-10-28)

### Fixed
- **Forensics stops recording when a licence or trial ends.** Nothing checked before, so a trial that ended kept recording every Bluetooth device it heard. What it already recorded stays searchable and exportable for its retention period, and recording starts again when you renew. The licence card, the Forensics card, the help and the update banner say so.
- **On a 4K wall, the People and Motion chips at the top grow with everything else.** They, the motion colour key and the window-open-in-the-rain line stayed 1080p-sized while the rest of the wall doubled.

---

## 0.38.190 — Split levels: a room higher or lower than the rest of its floor (2026-10-28)

### New
- **Split levels.** In a split-level house one floor isn't one height. An office can sit up a longer flight than the bedrooms beside it, or a living room a few steps down. Now you can say so per room. Most houses never need it, so it stays out of the way:
  - In **Mapping → Rooms**, pick a room. Under **Set height** there's a small **Split level…** link. Enter how far the room's floor sits above the rest of its floor (up to 3 m), or below it with a minus (down to 1.5 m).
  - Live Aboard draws the room at that height, standing on a short wall down to its floor. Lights, scanners and sensors placed in it move with it.
  - Stairs reaching a raised room climb the extra height and open into its floor. A flight that starts in a raised or sunken room starts from that room's floor.
  - If a floor above covers the room, its ceiling stays where it was. Otherwise the room keeps its full height and its roof rises over it.
  - Rooms raised by the same amount share one level. It shows, hides and spreads apart in Explode together with its floor, and gets no floor button of its own.
  - This is how home-design programs such as Chief Architect and Home Designer handle split levels: one room's floor raised, not an extra floor added. Home Assistant has no split levels, so your floors there stay as they are.
- **Tested on a gigantic house:** 6 floors, 720 rooms, 144 of them raised or sunk, and 60 stairs. Every stair landed on the right level. Reading the rooms took 0.23 s against 0.14 s with no split levels; working out its floors and roof took about 0.4 s either way; and turning it stayed smooth.
- **Usage report (if you share it):** only from a house with a split level, how many rooms are raised and how many sunk. Never which rooms or by how much.

---

## 0.38.189 — The AI features, tuned on a real model (2026-10-27)

### Changed
- **Furniture from a photo names what it sees, then reads it.** The AI now says what the piece is in its own words ("corner sofa", "office chair"), and PadSpan matches that to a kind. It then asks again for that kind's own details: seats, arms, legs, drawers.
  - Tested on a local vision model (qwen2.5vl:7b), it named the kind right for 6 of 7 photos. Before, it picked from a list and got 3 of 7, calling sofas, a chair and a table a fan.
  - It's quicker too, about 11 s with both questions.
- **It asks you for one measurement unless it can say what it judged the size by.** A "high" size confidence now needs something of known size in the photo, like a door or a tape measure. The model claimed "high" for nearly every photo with nothing to judge by.
- **Beds come out the right way round.** A bed's width is across the headboard. An answer the other way round is swapped.
- **Stairs from your floor plans place them better.** A shorter question placed stairs better on real plans: the boxes overlapped the real stairs 0.65 against 0.48 before, at 3–4 s a plan instead of 13. A staircase that fills much of a zoomed-in plan is no longer thrown away.

---

## 0.38.188 — Stairs read off your floor plans by AI (2026-10-27)

### New
- **Read stairs off the plans (AI).** With **Settings → AI → Stairs from your floor plans** on (it's off until you turn it on) and an AI Task picked, Live Aboard's Furnish → Build ▾ → House has **Read stairs off the plans (AI)**.
  - Your AI looks at each floor plan you placed and finds the staircases. PadSpan turns each one into stairs on the floor it climbs from: a flight marked DOWN on an upper plan goes on the floor below.
  - One staircase seen on two plans comes in once, and none is added where stairs already stand. Each is squared to its room.
  - They come in unsaved, as a first guess to check: where each stands, and which way is up.
  - A plan goes to your AI only when you press the button, and nothing is kept.
- **Tested on real plans** with a small local model (qwen2.5vl:7b): it found most staircases, but sizes and which way is up need checking. A bigger or cloud model reads plans better.
- **Usage report (if you share it):** how each plan read went (stairs found, none, an unreadable answer, a failure). Never the plan or where the stairs are.

---

## 0.38.187 — Settings → AI (2026-10-27)

### New
- **Settings → AI.** PadSpan's AI features in one place:
  - **Your AI:** the Home Assistant AI Task that reads for PadSpan. It moved here from the Live Aboard section.
  - **Furniture from a photo:** now has its own switch, on as before. It covers tags, receivers and people's figures too.
  - **Coming soon:** stairs read off your floor plans, rooms and walls traced from a floor plan picture, and asking your AI voice assistant where someone is.

### Changed
- **Furniture from a photo reads beds the right way round.** The AI is told a bed's width is across the headboard. In a real test with a local vision model it had swapped them.
- **Usage report (if you share it):** what each photo sent to the AI was of (furniture, a tag, a receiver or a person), and how long the AI took to answer, in bands. Where an AI Task is chosen, `env.ai` says only whether it runs locally or in the cloud. The photo, the answer and the AI's name are never in it.

---

## 0.38.186 — The trial card, put right (2026-10-27)

### Changed
- **What happens when a trial or licence ends, said truthfully.** Light placement goes read-only, and the 3D house, the wall screen, Locate and Busy Times switch off until you buy or renew. Nothing you set up is deleted, and it all comes back as you left it. The trial card, the licence card, the tiers page and its help used to say only that editing stops.
- **The launch price, plainly.** Once a trial has started, its card gives what Pro for life costs until November 30 and after, so it can't read as lasting the whole trial. The licence card leaves it to its own lifetime link.
- **Every place that offers the trial says it is all of Pro**: the Getting started list too, and the update banner says it once, as news, to installs without a key. On a PadSpan Bright build the trial card leaves out Forensics, which a Bright build doesn't show.
- **The paid features are named properly.** The licence card, the tiers page and its help list light placement, the 3D house, the wall screen, Forensics, Locate and Busy Times among them, and the update banner's Pro pitch names the 3D house and the wall screen too. They used to say a key unlocks two things. On a Bright build the licence card and the tiers page name only what a Bright build shows.

---

## 0.38.185 — The free trial is all of PadSpan Pro (2026-10-27)

### Changed
- **The 90-day free trial is all of PadSpan Pro.** It used to cover the lighting half only. Since October 27 the licence server issues every trial as full Pro, and trials already running became Pro at their next daily check, on every version. The trial card now says so ("PadSpan Pro free for 90 days, no card"), and the Locate and Busy Times gates say the trial unlocks them too. A PadSpan Bright build keeps its lighting pitch.
- **The launch price, while it lasts.** Once a trial has started, its card and the licence card say that PadSpan Pro for life is at its launch price until November 30, and that buying during the trial keeps everything you set up. The line goes away when the launch price ends.
- **The trial key comes by email too.** The licence server now emails the key to the address given on the trial card, as the card always said it would.

---

## 0.38.184 — Stairs from your plans, a first guess (2026-10-27)

### New
- **Stairs in stair rooms.** Furnish → Build ▾ → House → **Stairs in stair rooms** puts a flight in each room called Stairs, Stairwell or Staircase that has none yet. Each one is squared to the room's longest wall and sized to the room: a straight flight against a long wall, its rail on the open side, when the room is long enough, else a U or a flight round two landings filling it. It's a first guess to drag into place; nothing is kept until Save.
- **Stairs from Sweet Home 3D.** Import brings a Sweet Home 3D staircase in as stairs, not a box. Its shape is guessed from its name ("Spiral staircase", "L-shaped stairs", "half turn"), and a mirrored one turns the other way.
- **Stairs and furniture from a RoomPlan scan.** With RoomPlan import on (Settings → Features), Import also takes an iPhone RoomPlan scan (.json): its beds, sofas, chairs, tables, TVs, storage and stairs come in as pieces (anything else as a box of its size).

### Changed
- **Imported stairs are squared to the room.** A staircase from a file that is within about 12° of its room's walls is turned square to them.

---

## 0.38.183 — Open stairs, and stairs with two or three landings (2026-10-27)

### New
- **Open stairs and treads only.** A staircase in the 3D house (Furnish → Build ▾ → House → Stairs) now has a **Style**: Closed (the solid steps it always had), **Open** (the treads alone on a board each side, with gaps between them) or **Treads only** (nothing under them, fixed to a thin board along the wall).
- **Stairs with two or three landings.** **2 landings** goes up one side, across the back and down the other side to the front. **3 landings** goes round an open well: the last flight passes over the start of the first, high enough to walk under, and you step off at the side you started from.
- **A proper rail.** Open and treads-only stairs, and the new shapes, get a handrail on spindles with a post at each end, on the side you pick: **Both**, **Inside** (the well), **Outside** or **None**. Over the top flights it stands its full height, up into the opening in the floor above. Closed straight, L and U stairs keep the plain rail they always had unless you pick one.

### Changed
- **Install Base (pad.traks.ca and the developer view) says what each number means** in plain words, with the report's own name for it when you hover. Usage is split into what people did, what PadSpan did by itself and the screens it runs on.

---

## 0.38.182 — Room timing does what Settings says (2026-10-27)

### Fixed
- **A Room Change Delay of 0 now means 0.** Settings → Presence said "Set to 0 for instant room switching", but 0 was read as the 20-second default. Now a device switches on the first poll that agrees. Moves between indoors and outdoors, and to far-apart rooms, still go through their stricter checks. An unset delay is still 20 s.
- **A short Room Change Delay could hold a move to another floor for up to a minute.** When the delay fits in one poll (for example 10 s at a 10 s poll, or now 0), a move to another floor soon after the last one asked for two votes in a window that holds one. It now asks for at most what the window holds.
- **The outdoor rules recognise a Home Assistant floor called Outside** (or Outdoor, Garden, Yard, …), not only PadSpan's own outside floor. A proxy on such a floor gets the indoor↔outdoor treatment (a 15 dB penalty for moving outside, an 8 dB margin and every vote), where before it was treated as just another floor. The coverage rules already read it this way.
- **Presence Poll Interval shows the real default, 5 s** (it said 10 s). On an install still at 10 s, the old default from before 0.21, a note says that 5 s halves the wait for a room change. Nothing is changed for you: 10 s may be your choice for a slow machine.
- **The ESP32-C3 is no longer "Not recommended"** in the Bluetooth tab. With a full-size external antenna it did room-level tracking well in testing (the third of the three boards that worked, as Training and the README say). It's marked as the budget choice; an S3 or C6 is still better.

### Changed
- Code tidying with no change in behaviour: the coordinator's description of the room vote matches what runs, and two settings that never took effect are gone.
- **Usage report (if you share it):** `env.presence_cfg` says, in words, whether the poll interval or Room Change Delay is off its default and whether a Home Assistant floor counts as outside. It is sent only by installs where one of those applies.

---

## 0.38.181 — Free licences keep the usage report on, and portrait walls (2026-10-27)

### Changed
- **A new free licence needs the usage report on, and it stays on until that licence ends.** That covers the 90-day trial, a tester's two years of Pro and a free year of Pro from an invite. Each says so where you accept it: "can't be turned off until the trial ends", "while the key runs", "while the free year runs".
  - During the licence, Settings → Presence shows the report as on, with the reason and the end date, and its switch can't be used. A factory reset or a backup restore doesn't turn it off either.
  - When the licence ends, or once a bought key is entered, the report can be turned off again.
  - A tester key entered with the report off is refused until it's on. A free-year invite delivered from this version is claimed with the report on.
- **Existing free offers are not affected:** a trial started before this version, a tester key already in use, a year of Pro already claimed and an invite delivered before this version all work as before, and the report can be turned off as before.

### Fixed
- **A portrait 4K wall draws its text, controls and rain at the right size.** The scale compared the screen's width with 1920 and its height with 1080, so a 2160 × 3840 wall came out at 1.13× instead of 2×, and everything was about half the size it should be. Now the long side is compared with 1920 and the short side with 1080, so portrait and landscape get the same scale.

### New
- **Portrait walls on screens that can't turn their picture.** Settings → UI Structure → Wall screens → **Screen orientation** adds a turn to a screen's link (`&wall_rotate=90` or `270`). PadSpan then lays itself out tall and turns onto the screen, so a TV or stick that only shows landscape can hang on its side. A screen that turns its own picture needs nothing. See docs/WALL_SCREEN_GUIDE.md.

---

## 0.38.180 — Free offers come with the usage report on (2026-10-27)

### Changed
- **A new 90-day free trial needs the opt-in usage report on**, as the tester route and the free-year invites (sent only to installs with the report on) already did. With the report off, the trial card adds a box, "Turn on the usage report (needed for the free trial)", with a line on what the report is. Ticking it turns the report on and starts the trial in the same step, and nothing is turned on without the tick.
- **Existing free offers are not affected:** a trial already running, a tester key, a claimed year of Pro and an invite already delivered all work as before, report on or off.

### Opt-in report
- A trial started together with turning the report on is counted (`trial_optin:<where>`).

---

## 0.38.179 — Guest tags: the guest-home sensor appears when you turn them on (2026-10-26)

### Fixed
- **Turning guest tags on while Home Assistant runs now adds `binary_sensor.padspan_guest_home` straight away.** In 0.38.178 the sensor was added from a background thread, which Home Assistant refuses, so it only appeared after a restart. Checked on a real Home Assistant: guest tags refuse changes while off, only an administrator can turn them on, the sensor appears at once, Optimize for scale sends the slim update only while it is on, and nothing lands in Home Assistant's log.

---

## 0.38.178 — Guest tags, and walls that scale (2026-10-26)

Both are off until you turn them on.

### New
- **Guest tags** (Settings → Presence → Guest tags). Lend a tag PadSpan knows (a beacon, a Find My tag, a spare phone) to a guest: a house-sitter, a visitor, a cleaner. A new **Guests** tab (there only while guest tags are on) shows where they are, since when and until when, and the time in each room. You can be told when they arrive or leave, and when they spend half a minute in a room you set as off-limits. Quiet hours hold the arrive and leave notices. A house-sitter can count as someone home for Vacation Mode.
  - **Tag returned** ends the stay and keeps its report (first in, last out, time per room, off-limits visits, notices) for 30 days, or the 0, 7 or 90 you choose.
  - A forgotten stay asks after two days without the tag being heard, and ends itself after a week.
  - The tag keeps its own name and entity from guest to guest. While it is lent, its `device_tracker` carries the guest's name and stay.
  - `binary_sensor.padspan_guest_home` and the `padspan_ha_guest` event are there for automations.
  - Guests' names never leave your Home Assistant: not in the usage report, not in a backup. Only an administrator can lend a tag or end a stay.
  - See docs/GUEST_TAGS_GUIDE.md.
- **Optimize for scale** (Settings, next to Low-memory mode), for several wall screens at once:
  - The Overview and the Atlas's 3D people ask for a slim update (people, tags and placed devices, with the counts) instead of every passing Bluetooth device. In a busy real house that was about 50 KB instead of 2.2 MB, every 5 seconds, per screen.
  - Screens polling within 4.5 s of each other share one build.
  - A hidden page asks for nothing.

### Opt-in report
- Only where they are on: guest tags as words (how many tags and stays, the last stay's length and how it ended, how many off-limits rooms, quiet hours, house-sitter, the kind of tag, the retention). Never a name. Plus counts of stays, notices sent, failed or held, off-limits notices and stays that ended unheard.
- Whether Optimize for scale is on, and how many slim updates are sent.

---

## 0.38.177 — Calibration catches an unmeasured floor first (2026-10-26)

### Fixed
- **Calibration no longer lets you collect points on a floor that has no metre scale.** A calibration point is a spot in metres, so on an unmeasured floor every save was refused, after you had stood still for the capture. A new install did exactly this: seven refused saves and three exits from the guide on its first day. Now Setup says "This floor needs a measurement first" right under the floor you picked, the guide stays on Setup until the floor is measured, and Pin & Listen and Roam show the same card instead of the map. **Measure this floor →** opens that floor plan in Mapping → Edit with the Measure tool already chosen.
- **Licence homes:** a home removed from its key can ask for a free place again by pressing Activate, and a home that is paused or has its usage report off still takes a renewed expiry date.

### Opt-in report
- **Panel errors say what kind they were and where.** Beside the module that threw, the error's kind (type, reference, range, syntax, rejection, other) and the line in PadSpan's own file it came from. Still never the message.
- **Why a calibration save failed:** the floor had no metre scale, or something else. And when the Calibration tab showed a floor needs measuring.
- **Clearing calibration points and deleting floor plans are counted**, and the report flags it when calibration points or floor plans are gone since the last report with no clear or delete in between. That is how lost data would show, as opposed to data someone removed.
- **The day's counts survive a restart.** They were kept only in memory, so a day with restarts lost what happened before them.
- The Light and Day theme switches (`features.light_theme`, `day_theme`) are sent only when on, like the other switches since 0.38.160.

---

## 0.38.176 — Shelly scanners get their room without a restart, and the BLE Proxy Compatibility switch works (2026-10-26)

### Fixed
- **A Bluetooth scanner whose own device has no area takes the area of the device it belongs to.** Since 2025.2 Home Assistant files each remote scanner, a Shelly's for instance, as its own device under **Settings → Devices & services → Bluetooth**. It copies the area of the device that provides it only when the scanner's device is set up and has no area yet. So a Shelly given its area after its scanner appeared had a scanner with no area, and no room, until Home Assistant restarted. Now PadSpan uses the Shelly's area until the scanner's device has one of its own; a scanner device with an area keeps it.
- **"Enable aggressive BLE reseed (5s) for passive proxy scanners" works.** Manage → HA Entities → BLE Proxy Compatibility said it reseeded every 5 seconds, but the reseed interval in **Settings → Presence** (30 s unless changed) always won. The checkbox now caps the interval at 5 s, and a shorter interval set in Settings → Presence stays.

---

## 0.38.175 — A Shelly scanner finds its Shelly by MAC (2026-10-26)

### Fixed
- **A Shelly scanner finds its Shelly when no device lists its Bluetooth MAC.** Home Assistant registers a Shelly's scanner under the Shelly's Bluetooth MAC, its network MAC + 2, while the Shelly's own device lists only the network MAC. Home Assistant 2025.2 and later also file each scanner as a device of its own with that MAC, which PadSpan already used. Without one, PadSpan matched the scanner by name or not at all. Now it matches the scanner to its Shelly device by network MAC + 2, and the Overview's area picker finds it too. Only Shelly integration devices get this rule.

---

## 0.38.174 — Your own house first: who's where before any floor plan, and the wizard puts your plan on the map (2026-10-26)

A new install used to open on the demo house, and showed its own rooms only after a floor plan, a scale, traced rooms and placed scanners. An install from before keeps the mode it is in, and its map.

### New
- **A new install opens on its own house.** As soon as Home Assistant reports a Bluetooth scanner, PadSpan switches from the demo house to Live, unless you picked a mode yourself first. A panel already open notices within seconds.
- **Who's where now.** Until you draw rooms, the Overview starts with each room your scanners cover (each scanner's Home Assistant area) and who is in it now, from the scanner that hears them best, plus a count of everything else heard. It says what your scanners give you ("4 scanners cover 3 rooms …") and names any scanner with no Home Assistant area, which can't give a room. Someone heard only by such a scanner is listed under "Heard, no room yet".
- **Track, in one click, for phones in Private BLE Device**, in range or not: it names the phone in PadSpan and follows it, so it gets its room and home/away sensors. With Enhanced security on, that's an administrator's. Track Your Phone (Android) opens by itself on a house with no rooms drawn.
- **The demo house is behind "Preview a finished house"**, says it is made up, and has **Back to my house**. Getting started reads "Make it a map (optional)" while who's where already works.
- **Setup Wizard: Put it on the map.** Finishing the wizard now says which traced rooms and placed scanners aren't on the map of your house yet, and one click puts them there, the way Mapping → Rooms → Commit and Calibration → Tune → Save do. Only what's missing is written, only from the plan you just traced, and never while the demo house is showing; nothing already on the map changes. Before, the Overview had no house until you found those two buttons.

### Opt-in report
- Nothing new is sent. The time to a new install's first room (reported since 0.38.165) shows whether this helps.

---

## 0.38.173 — How new installs get on (2026-10-26)

Nothing changes in the panel for anyone.

### Opt-in report
- **How old the install is, as a range** (under a day, 1-7 days, 8-30, 31-90, over 90). With it the developer can tell a brand-new install from one that has run for months and only just turned the report on. It is worked out from when PadSpan first saw the install, so an install older than 0.38.87 reads as first seen the day it updated past it.

### Developer
- **Install Base (Dev mode): a New installs section.** New installs by the week they first reported, how many were really new, still reporting, reached day 7 and day 30, and sent one report only; how far the last 30 days' new installs got with setup (map, rooms, receivers, calibrated); and the ones that went quiet, with where each stopped. The installs table gains first report and setup stage. The nightly summary has the same section.

---

## 0.38.172 — Vacation Mode options and a status entity (2026-10-26)

Nothing changes until you set an option: an install that never opens Options runs Vacation Mode exactly as before.

### New
- **Vacation Mode options.** Open them from the banner's **Options** button, or with **Options** beside Apply while 🌴 Vacation Mode is picked in Whole house. These are the features the common away-lighting products have (Hue, Lutron, Kasa, Hubitat and others), on top of the routine PadSpan learns from your own house:
  - **Only after dark**: lights go on only after sunset (or 30 minutes before it, or up to 2 hours after it) and before sunrise. Lights it would have turned on during the day stay off.
  - **Ends**: set a date and time and it turns itself off then. You get a notification saying it ended as planned; the banner shows the end.
  - **Pause while someone is home**: while anyone in Home Assistant's People is at home, nothing is switched, and nothing is forced off. It picks up again when they leave.
  - **Bedtime**: every light it runs goes off from about that time until 5 am. The time moves up to 20 minutes either way each night, so the house doesn't go dark at the same minute every night.
  - **Longest on**: a light it turned on goes off after 1 to 6 hours, and stays off as long.
- **`binary_sensor.padspan_vacation_mode`**: on while Vacation Mode runs. Its attributes give when it started, when it ends, which routine it runs, the options, whether it's paused because someone is home, and who last turned it off. The **`padspan_ha_vacation_mode`** event fires on every change, with `on` and `how` (`panel`, `resumed`, `end_date`, `reset`, `paused_home`, `unpaused`), for your own automations (an alarm armed with it, a message of your own).
- The options and the end date need an administrator account, like turning Vacation Mode on or off. A backup restore keeps the live end date.

### Opt-in report
- For installs that use Vacation Mode: which of the five options are on (yes/no), and "ended on its end date" as a way it went off. Counted: ended on its end date, paused because someone came home, and, once a day each, the after-dark, bedtime and longest-on rules holding a light off.

---

## 0.38.171 — Vacation Mode can't be switched off by accident (2026-10-25)

One tap on the Vacation Mode banner turned it off mid-trip at a real house, and the lights stayed off for 11 days with nobody told.

### Fixed
- **Disable asks first.** Tapping Disable on the banner (Overview's Atlas and the sidebar Atlas) asks "Turn off Vacation Mode? The lights stop acting like someone is home." "Turn off" is at the far left; "Keep it on" is at the right, where Disable was, so a second stray tap keeps it on. The question goes away by itself after 10 seconds.
- **When it goes off, the house is told.** Home Assistant shows a notification saying when, by which user and from which app or browser (or that a PadSpan factory reset did it). The same message goes to the phones or email your Follow alerts use, if any are set.
- **Turned back on within 3 weeks of a trip, it carries on with that trip's routine.** Before, switching it back on learned the routine from the last 30 days of light history, which after an accidental Disable is mostly the empty house, so most lights stayed off. The banner says "same routine as the last trip" when it does this. After 3 weeks, or for a new trip, it learns afresh as before.
- **Restoring a PadSpan backup leaves Vacation Mode as it is.** Before, restoring a backup taken while you were home turned it off. A factory reset still turns it off (and now says so), but keeps the learned routine so it can carry on.

### Opt-in report
- Only for installs that have used Vacation Mode: whether it is on, the intensity, how many lights it learned and which routine it runs (its own, the last trip's, the stand-in, or none yet), switches a day, trips in the last 60 days and the last trip's length, all as ranges, and whether it was last turned off from the panel or by a reset. Also counted: switched on, resumed, turned off, and whether the turned-off message reached a phone or email. Never who turned it off or from what.

---

## 0.38.170 — Honest stale-receiver button (2026-10-25)

### Fixed
- **Mapping → 3D Stack: the stale-receiver button no longer claims a removal.** It said "Clean N stale" and then "Removed N ✓", but nothing was ever removed or saved. It is now a read-only "N stale" button: it lists which receivers on which maps no live Bluetooth scanner matches right now (a scanner that is offline or renamed shows here too), says that nothing has been removed, and explains how to take one off a floor plan today (Edit → click the receiver → Delete receiver → Save Layout). A house with no stale receivers looks exactly as before.
- **Code left empty when the old photo-to-metres save was removed (0.30) is tidied.** Nothing visible changes: the Edit tab's rotate no longer computes rotated pins and outlines it never sent (the server turns them with the image, as before), the Measure tool's scale save drops an empty step after it, and Calibration's radio Delete and Beacon Tune's dedup and beacon Delete lose loops and comments that said they saved something they did not.

---

## 0.38.169 — Help in Dutch, German and French (2026-10-25)

Used only when the Home Assistant profile language is Dutch, German or French. Everyone else, English included, sees the help exactly as before.

### New
- **Help in Dutch, German and French.** The ? help pages, and the manual sections built from them, follow the Home Assistant profile language when it is nl, de or fr. Each translated page starts with a short note: the rest of the panel is still in English, so the names of its tabs, buttons and settings are given in English, in quotes. Home Assistant's own screens are named with Home Assistant's own words in that language (for example Instellingen → Apparaten en diensten, Einstellungen → Geräte & Dienste, Paramètres → Appareils et services).
- The Training tab's Quick Start and Full Manual keep their English section names around the translated help, and open with the same note. If a translation can't be loaded, the help is simply in English, with no note.
- The "Free, Bright, Bright Pro, Pro" page stays in English in every language for now.
- The translations are a first draft and have not yet been checked by native speakers. Corrections are welcome as GitHub pull requests.

---

## 0.38.168 — Beacon Tune fixes (2026-10-25)

### Fixed
- **Beacon Tune shows saved beacons after a reload (#89).** It read each map's own beacon list, which saves stopped writing in 0.38.107, so a saved beacon came back as "Not placed", or at its old spot while Overview showed the new one. It now reads the saved position, the same one Overview uses, and falls back to the map's list only for a beacon with no saved position. Nothing is rewritten or removed.
- **Panning a map by touch ends when the finger lifts (#90).** With Auto-Cal on, Beacon Tune redraws its map every second; a redraw during a one-finger pan left the pan running, so the next beacon drag moved the map too and could save the beacon far outside the house. The same map code is used by Pin & Listen, Roam and Rooms; mouse, wheel and keyboard behave as before.
- **Pinch zoom stays centred between the fingers.** It drifted a few pixels per zoom step; it now zooms about the same point the mouse wheel does.
- **A beacon dropped outside the map is put back.** Beacon Tune no longer saves a beacon dragged off the edge of its map; it returns to where it was, with a message.
- **Double-clicking on a beacon while placing another places it there.** Each click redraws the map, so a double-click on top of an existing beacon was lost. Now, while a beacon is waiting to be placed, a double-click on an existing beacon places the new one at that spot, as anywhere else on the map. Otherwise it selects the beacon, as a single click does.

---

## 0.38.167 — Walk a room (2026-10-25)

Off until it is turned on. With it off, Calibration and positioning are the same as before.

### New
- **Walk a room.** Settings → Presence → Walk a Room adds a "Walk a room" tab to Calibration. Pick the room, press Start and walk slowly around it for 90 seconds with the phone or tag chosen in Setup; a ring counts down while PadSpan samples that device's signal from every scanner. Afterwards it shows how many samples and scanners it heard and how far the room's signal sits from the closest other room, then asks whether to save. Nothing is stored until Save is pressed; Discard throws the walk away.
- **A saved walk is ordinary calibration, kept apart.** It is added as six calibration points at the room's centre, one per stretch of the walk, marked as a room walk. Walking the same room again replaces only that room's earlier walk, after a confirm, and a walk can be removed room by room. No other calibration point is changed.
- **Before and after.** After a save the tab shows the held-out score from before the walk and after it, so it is clear whether the walk helped.
- Turning the setting off hides the tab but keeps saved walks in positioning. To take a walk out, turn it on and use Remove on that room's walk.
- With Enhanced security on, saving or removing a walk is for admins only.
- The opt-in usage report says whether the setting is on, and, only while it is on and a room has been walked, how many rooms have a walk (in ranges) and whether the last walk moved the held-out score up, down or not at all.
- For developers: tools/benchmark scores PadSpan's accuracy on recorded walks (docs/BENCHMARK.md).

---

## 0.38.166 — Stable: 4K wall screens, Enhanced security, an honest accuracy score, and one licence for five homes (2026-10-25)

- **Coming from 0.38.157?** This stable brings in everything from the 0.38.158–0.38.165 betas below. New options are off until you turn them on; with nothing turned on, rooms, positions and screens are the same, apart from what's listed here.
  - **Wall screens:** the sidebar Atlas as `?kiosk=1` becomes a 4K-ready wall screen sized for the screen and how far away you stand, with its own Settings card, per-screen links, night dimming, burn-in protection, and controls that fade when nobody's touching it.
  - **Rooms taller than their floor:** a double-height living room or a hall under a gallery uses Rises to in Mapping → Rooms. Live Aboard's walls stop under the floor above, the floor stepper cuts tall rooms too, and moving a room takes its open edges with it.
  - **Live Aboard:** a new Studio look (a lit model under a sky that follows the sun), trails, flying to what goes off and to people who arrive, and an optional frame-rate readout.
  - **The Atlas:** lights in their own colours, blinds and garage doors, an alert pulse, and the heatmap (PadSpan Pro). Sub-zones (bed, couch, desk) with their own sensors.
  - **Accuracy:** Calibration and QA show how each method does on spots it hasn't seen, beside the old estimate. Three new choices under Settings → Presence → Positioning Choices, all off: pick the better method, mark a room as unsure, and use motion sensors to break ties.
  - **Security:** names are always shown as text, Follow's test sends only to notification targets, and a new Enhanced security setting (off) lets only administrators change the shared setup.
  - **Setup:** new installs start with the iPhone setup steps on; a note appears when a Bluetooth proxy suddenly hears much less; the setup screens are translated into ten languages; the Getting Started guide says what you need and has a note about first-time HACS setup.
  - **Everyone:** the High contrast theme is no longer PadSpan Pro only, and a screen reader can read who is in which room.
  - **Licences:** one PadSpan Pro key covers up to five homes (with more than two, every home keeps its usage report on). Pro for life is $89 CAD until November 30, 2026, then $168 CAD.
  - **Safer by default:** deleting another integration's entity or an area asks twice, Enable & Track only turns on a phone's BLE Transmitter, and on Home Assistant before 2026.8 PadSpan's devices no longer merge into Bermuda's.

## 0.38.165 — New-install setup help, proxy health, an honest accuracy score, High contrast for everyone, and setup screens in ten languages (2026-10-24)

Everything new here is off until you turn it on, except High contrast, which every edition now gets, the new accuracy line, which sits beside the old one, and the iPhone setup guide, which is on for brand-new installs only. With nothing turned on, rooms and positions are the same as in 0.38.164.

### New
- **New installs start with the iPhone setup steps on.** An install set up for the first time on this version has Settings → Features → iPhone Setup Path turned on, so an iPhone is given the IRK steps. Installs from before keep what they had (off unless someone turned it on). It can be turned off like any other setting.
- **A note when a Bluetooth proxy suddenly hears much less.** PadSpan compares each scanner's advertisement rate with its own usual. If one hears under 30% of its usual for more than 10 minutes while the others are normal (as with the ESPHome Wi-Fi and Bluetooth coexistence problem in 2026.7, when proxies heard about a tenth of what was around them), Health shows a short note naming it, until it is back over 60% of its usual for three minutes. Nothing is shown otherwise. Each scanner's usual is learned over its first half hour after Home Assistant starts.
- **Accuracy on spots it hasn't seen.** Calibration → Model and QA now show, beside the existing estimate, how each method does on calibration spots it was not given: every point within 1.5 m of the spot (and the rest of a beacon's own points) is set aside before it is tested. It reads "Tested on spots it hasn't seen: fingerprints X% rooms right, median N m; spatial …". It is usually worse than the old estimate, which is tested with near-copies of each spot still in, and closer to what you see as you walk around. The old estimate is unchanged. Calibration points are only read, never changed. It is worked out in the background on up to 60 spots spread over every floor and room, so the tabs open straight away with the last result.
- **Pick the better method for this house.** PadSpan places devices from the radios' positions (spatial) and from your calibration points (fingerprints), and has always preferred spatial. With this on, it prefers whichever did better on unseen spots, and switches only on a clear win (5 points of rooms right, or half a metre), so it does not flip back and forth. Settings → Presence → Positioning Choices.
- **Mark a room as unsure when the signal is thin.** When fewer than 3 scanners hear a device, or no calibration point matches it well, it keeps the room it had and is marked unsure (if the same new room keeps coming for 5 readings in a row, it moves there): a `room_unsure` attribute on its entity and a quiet line in its details. Same place.
- **Use motion sensors and usual moves to break ties.** When two rooms read within a few dB of each other, a motion, occupancy or presence sensor in one of them, and the room-to-room moves PadSpan has learned, decide between them. It never picks a room no scanner hears. Same place.
- **The map as text for screen readers.** On the Overview, and on the Atlas while it shows people or tags, a screen reader can read who is in which room ("Kitchen: Alice's iPhone. Office: empty."). It lists only what the map shows, and reads a room's line when it changes, at most every 10 seconds; opening the map does not read the whole house. The text is not shown on screen, so the panel looks the same as before. The maps are now labelled "House map" for screen readers.

### Added
- The opt-in usage report counts how many times a proxy started hearing much less (as 1, 2–5 or more) and, once, for an install set up on this version or later, how long it took from setup to its first device in a room and to its first calibration point, in buckets. Counts only, and only with the report on.
- The opt-in usage report carries the unseen-spots score as ranges only (rooms right, median error, which method did better), where calibration gives one; whether each new choice is on; and, only while on, the share of devices marked unsure and how often motion sensors changed a room.
- **Groundwork for translating the panel.** A small built-in helper that will let the panel show a reviewed translation when your Home Assistant profile uses that language, with English as the fallback for anything not yet translated. No language is shipped yet and no text has been converted, so the panel looks exactly as before in every language, and English never loads anything extra.

### Changed
- **The Getting Started guide** has a short "what you need" box: how many scanners, roughly what they cost, and how long setup and calibration take.
- **High contrast is in every edition.** Settings → Appearance → Theme offers Night, Light (inverted) and High contrast without PadSpan Pro; Graphite, Ocean, Dusk and Day still come with Pro. A High contrast picked earlier now shows without Pro too.
- **Less motion when the browser asks for it.** With "reduce motion" set in the operating system or browser, the Overview's dots (and Traceback's) go straight to their new spot instead of gliding and fading, and the Overview map changes without its fade. Without that setting nothing changes.
- **Setup screens and the WLED actions in ten languages.** Danish, Dutch, Finnish, French, German, Italian, Norwegian, Portuguese, Spanish and Swedish now have real translations of the setup and options screens and of the "WLED on with its look" and "WLED off" actions and their fields. Before, these languages showed English. English is unchanged.
- **A note on first-time HACS setup** in the Getting Started guide (and a pointer in the README): since 2026-10-23 a GitHub change can make a first-time HACS setup fail at the GitHub sign-in step (`could_not_register`) until HACS releases its fix. Existing HACS installs keep installing and updating PadSpan normally. The note will be removed once HACS ships the fix.

---

## 0.38.164 — Enhanced security, the Studio look, and Live Aboard walls stop under the floor above (2026-10-24)

Everything new here is off until you turn it on. With Enhanced security off and the Live Aboard look unchanged, PadSpan works as in 0.38.163, and houses whose floors stack normally look the same; names are now always drawn as plain text.

### New
- **Enhanced security.** For homes where other people have Home Assistant accounts. While it is on, only an administrator can change PadSpan's shared setup: devices, calibration, the house layout, scanner offsets, Follow alerts, clearing history, suspending learning, Live Aboard edits and its library and photo reader, the log, and the settings that apply to the whole home. Household members can still view and use PadSpan, change the theme and the choices kept in their own browser (Map or 3D, what the Atlas shows), and assign a Bluetooth radio to a room; display settings that change every screen in the home (Quiet mode, the Atlas as Overview, the Atlas layout and its showcase theme) need an admin while it is on. Anyone else who tries a change is told "Only an admin can change this while Enhanced security is on". More protections will be added to the same switch. Off by default, and only an administrator can turn it on or off: Settings → Presence → Enhanced security. The opt-in usage report says only whether it is on.
- **Studio, a third look for Live Aboard.** Your house as a lit model on a stage: Live Aboard's own colours (every room, light and name stays as it is), under a sky that follows the real sun (`sun.sun`): a soft day, a warm golden hour, a deep blue dusk and a moonlit night with a few stars. The house stands on a soft pad that fades into the sky's horizon, with a faint metre grid and a soft shadow under it. A gentle fill keeps shadows coloured instead of black, a front light gives every wall form, the walls darken a little at their foot, and brightly lit walls and floors roll off softly instead of clipping to white (names, chips and glows keep their exact colours). Rain falls slate blue on the light day sky. The camera glides in once when the view opens (not with reduced motion). Pick it in Settings → Live Aboard → Look → Studio, or in the Live Aboard setup wizard's extras.
- **Light enough for wall tablets.** On Low, Studio keeps the sky's colours, the stage, the shadow under the house and the soft fill; the sky dome with its stars, the front and rim lights and the softer sun shadows are High's. Auto, Low and High and the slow-screen fallback work as before.

### Added
- Counts a house where a wall was stopped under a floor above (`house3d_wall_capped`), once per page load, only with the usage report on.

### Changed
- **Names always show as plain text.** Scanner names on Health, calibration point names on the Calibration map, and a few other values in Traceback, QA and the map's scanner hover are drawn as text whatever characters they contain. Ordinary names look exactly the same.
- **Follow's Test button and alerts send only to notification targets**: a notify service or entity, or another integration's `send_message`, as the picker offers. The Test button sends as the person who pressed it.
- **README, SECURITY.md and the Getting Started guide** say who can change what, and how to report a security issue.

### Fixed
- **Walls no longer rise through an upper floor.** Where a room upstairs stands over a wall that would reach past its floor, the wall stops under that floor. This covers walls between two rooms of the same height (a hall floor given its full height under a walkway, a split level), a tall room's walls under a room that overhangs them, and a wall under a walkway's Open (Loft) edge.
- **No thin posts on tall rooms.** A tall stretch of wall shorter than 30 cm that meets no other tall wall (a tiny jog in a room's outline) keeps its floor's height.
- **The floor stepper cuts tall rooms too.** With the floors above hidden, a tall room's walls stop where those floors start, like the rest of the house.
- **A mezzanine named "Deck" stays indoors.** A room named like a deck or patio that stands inside a taller room of the floor below keeps its walls and roof. Decks and patios on a normal storey are outdoors as before.
- **Strip lengths count only what lights.** A run with gaps (along a rail, or round a room past its doors) shows its lit length, with the whole length including the wire in the panel.
- **Moving a room in Mapping → Rooms takes its walls with it.** An Open (Loft) edge, a door or any barrier drawn on the moved room's outline moves too and is saved with it. A wall it shares with a room that stays put doesn't move.
- **The RF Barriers help gives the right mezzanine setup.** Keep the floor at its normal height in Floor Heights and give the hall its full height with Rises to in Rooms, as the Floor Heights help says.

### Opt-in report
- `look_studio` in `features.ov_3d`, only while Live Aboard is on and Studio is picked (as `look_own` is for Live Aboard's own).

---

## 0.38.163 — Every home on a key with more than two keeps its usage report on (2026-10-23)

With a licence key on one or two homes, nothing changes.

### Changed
- **A key on more than two homes needs every home's usage report on.** A licence's first two homes always count. With more than two, every home on the key must keep its opt-in usage report on (Settings → Presence → Help improve PadSpan). If one turns it off, the key drops back to its first two homes after 14 days: the first two keep Pro, and the others stop using Pro until the report is back on, then pick up again at their next check. A new home joins as a third only when every home, the new one too, has the report on. The 14 days add up: turning the report back on briefly doesn't start them again, and they start again after every home has had it on for 30 days. A home on PadSpan before 0.38.160 can't send the report, so it counts as off until it's updated, and the licence card says it needs updating.
- **The licence card says so.** When the report is off on a key with more than two homes, Settings → Features → PadSpan licence names the homes it's off on and the date the homes beyond your first two stop using Pro. Turning the report off on such a key asks first (with the date, if the 14 days are already running), and Cancel keeps it on. Removing a home from the list so the key is back to two clears the warning at once. Turning the report on or off with a key in tells the licence server straight away instead of at the next daily check.
- On 0.38.163 a home beyond the first two stops using Pro when its 14 days are up, with no second grace on top. Homes still on PadSpan 0.38.160 to 0.38.162 don't show the warning, and keep their usual 14-day grace after that.
- **README and the PadSpan Pro guide** say how a key's homes count now.

## 0.38.162 — An iPhone setup path, Live Aboard flies to people arriving, and Follow the sun (2026-10-23)

Everything new in this version is off until you turn it on. With nothing turned on, PadSpan looks and works as in 0.38.161, apart from the safer delete buttons, Enable & Track turning on only a phone's BLE Transmitter, and the fixes below.

### New
- **iPhone setup path.** iPhones have no BLE Transmitter (that sensor is only in the Android Companion App), so with this on an iPhone in Overview's phone list and in the IRK Manager's phone wizard walks through getting its IRK (an IRK Capture ESP32 or a Mac), adding it with Private BLE Device and checking that it resolves. Android phones see the same steps as before. Off by default: Settings → Features → iPhone Setup Path.
- **Live Aboard flies to people who arrive.** Besides what goes off, Live Aboard can fly to a person or tag you pick when they go into a room you pick, or, with no room picked, any room or a person arriving home. Same card and same rules as "Fly to when it goes off", at most once every 2 minutes for each one, and it never replaces a card that is already up. Only people and tags Live Aboard shows are flown to. Off until someone is picked: Settings → Live Aboard → "Fly to when they arrive".
- **Follow the sun.** The panel is Day from sunrise to sunset (Light (inverted) without PadSpan Pro), then the theme you picked (Night if that is Day or Light). It goes by Home Assistant's Sun integration (`sun.sun`); without it the theme stays as picked. Off by default: Settings → Appearance → Follow the sun.
- **Frame-rate readout in Live Aboard.** A small readout in the corner says how many times a second the 3D house is drawn, and "0 fps at rest" when nothing is moving. This browser only, off by default: Settings → Live Aboard → "Show the frame rate".

### Changed
- **Deleting another integration's entity, or an area, asks twice.** Manage → Delete on an entity that isn't PadSpan's names the integration it belongs to and asks you to confirm two times; deleting an HA area says it is deleted from Home Assistant itself (its devices and entities become unassigned) and asks two times. PadSpan's own entities keep the in-row Yes, delete / Cancel.
- **Enable & Track only ever turns on a phone's BLE Transmitter.** The phone action re-enables that one Companion App sensor and nothing else; any other entity is refused before anything changes.
- **README: "What PadSpan never touches".** What PadSpan reads, what it creates, the buttons that are the only exceptions, and what uninstalling removes. A repo test now fails if code tries to change another integration's devices, entities or config entries.

### Fixed
- **On Home Assistant before 2026.8, PadSpan's devices no longer merge into Bermuda's** (or another Bluetooth integration's) device for the same Bluetooth address, so a newly labelled device no longer overwrites that device's name and model. Devices already merged stay merged (Home Assistant doesn't split them on those versions). From 2026.8, where Home Assistant keeps them apart itself, nothing changes.
- **Licence homes:** activating the same key again keeps this home's place on the licence. A temporary refusal from the licence server (a key that joined many new homes this month) no longer ends Pro, and neither does a third to fifth home with its usage report off: the licence card says why the home isn't counted. A home removed from its key says so on the licence card. A revoked, expired or removed key works as before.
- **Assist's "which room is" intent** is not offered to LLM conversation agents as a tool on Home Assistant before 2026.8 (from 2026.8 it never was); the custom sentences reach it as before.
- **Live Aboard's frame-rate readout** stops, timer and all, when the screen goes back to the flat Atlas.
- **Monitor with quiet mode on:** the tracked count and the hidden count add up to the devices listed.
- **README and guides:** what the daily licence check sends since 0.38.160, how a key's five homes count (PadSpan Pro guide), and that devices Home Assistant merged before 2026.8 stay merged.

### Opt-in report
- What the Overview drew, as words (`overview_shown:*`: house, empty house, floor plan, room grid, flat map, Atlas, Atlas 3D, and Basic mode), from live data only, each screen once per report.
- How the Overview's house, Atlas and 3D house are set up (`features.ov_house`, `ov_atlas`, `ov_3d`), only for settings changed from their defaults, as words, never the numbers. A screen on its defaults sends nothing.
- From a house with two screens or more, each of its first five screens' words (`env.screens`): what its Overview drew, its kind of window, resolution and kind of device. Never a screen's id.
- With quiet mode on, roughly what share of the objects it hides (`env.quiet_hidden`: under 25%, 25-50%, 50-75%, over 75%). A house with quiet mode off sends nothing new.

---

## 0.38.161 — The heatmap is PadSpan Pro's, and Pro for life's new price (2026-10-22)

### Changed
- **The Atlas heatmap is part of PadSpan Pro.** Below Pro there is no Heatmap chip and no Settings row for it; a choice made while on Pro is kept for when a key comes back.
- **PadSpan Pro for life** is $89 CAD, once, at the launch price until November 30, 2026, and $168 CAD from December 1 (no longer an offer that ends). The licence card and the trial offer say so, and switch on the day.

### Fixed
- A RoomPlan file nested absurdly deep is refused with the same plain message on every system.

---

## 0.38.160 — One licence for five homes, and new things to turn on for the Atlas, Live Aboard and wall screens (2026-10-22)

Everything new in this version is off until you turn it on. With nothing turned on, PadSpan looks and works as in 0.38.159.

### New
- **One licence, up to five homes.** A PadSpan Pro key now covers up to five Home Assistants. The first two homes always count; homes three to five count while their opt-in usage report is on (Settings → Presence → Help improve PadSpan). **Settings → Licence → Homes** lists the key's homes with each one's place and whether its report is on, lets you rename this home and remove any of them, and says why a home isn't counted when the licence server refused it. A new install takes the place of a home that has been silent for 14 days or more, and a restored backup stays the same home.
- **Lights in their own colours on the Atlas.** A lit light that reports a colour (a colour bulb's colour, or a white bulb's warm or cool) is drawn in it instead of amber. Off by default: Settings → UI Structure → Atlas → "Draw lit lights in their own colour on the Atlas". Lights with no colour, custom pin colours and off lights look as before.
- **Blinds, shades, garage doors and gates on the Atlas.** A cover can be linked to a wall section like a door or window sensor. It reads open while any of it is open or it is moving; part-way open, its row says how far ("OPEN 40%") and the wall shows a small "40%" (which grows on wall screens). A garage cover swings as a garage door; blinds and shades draw no door leaf. Left open for hours, it is flagged like a door. A cover is on the Atlas only once it is linked (Mapping → a door's wall section); until then nothing about it changes, and door and window sensors are unchanged.
- **Heatmap on the Atlas.** A new "Heatmap" chip beside the class chips cycles Off, Temperature, Humidity and CO₂, for the kinds your house has sensors of. Each room is coloured inside its own walls from the sensors placed in it (or, with none placed, its own area's sensors), with a small key: a green comfort band for temperature and humidity, green at 400 ppm to red at 1500 ppm for CO₂. Only readings from the last hour count. Off by default: turn on Settings → UI Structure → Atlas → Heatmap chip, then each browser remembers its choice.
- **Alert pulse on the Atlas.** A door left open for hours, or a window or cover open while it rains or snows, rings its room in amber, the way a leak already does (leak, smoke, gas and CO keep their red rings). On a wall screen a banner across the top names the worst alert and where it is ("Leak · Laundry") until it clears. Off by default: Settings → UI Structure → Atlas → Alert pulse.
- **Trails in Live Aboard.** Where each person and tag went in the last half hour, as a fading ribbon in its own colour on the floor it was walked on. Off by default and kept per screen: Views menu → "Trails, last 30 min" (offered while Show people or Show tags & scanners is on). Nothing new is recorded; the trails come from Traceback's own history.
- **Live Aboard flies to what goes off.** On the sidebar and wall screens, the camera flies to a doorbell that rings, a door that opens, a sensor that goes off or an alarm that is triggered, shows a card (with a camera's snapshot if you picked one), then goes back to its home view after 20 s. If someone touched the screen in the last 20 s, or a card, Edit, Furnish or full screen is open, only the card shows. Off until an administrator picks what to fly to: Settings → Live Aboard → "Fly to when it goes off".
- **Wall screens: each floor in turn, and Fully Kiosk.** Two new options in Settings → UI Structure → Wall screens, both off by default. **Show each floor** shows All, then one floor at a time, every 15 seconds to 5 minutes, waiting while someone is using the wall. **On Fully Kiosk tablets**, night dimming turns the screen's own brightness down instead of the dark overlay, and Fully's motion detection turns a sleeping screen back on (needs Fully's JavaScript Interface, and Motion Detection for the second).
- **Sub-zones.** Named areas inside a room (the bed, the couch, the desk), each with its own `binary_sensor.padspan_<name>_occupied` and `sensor.padspan_<name>_who`, worked out from each labelled tag's position, with margins and a short wait so they don't flicker at the edge. Off by default: Manage → HA Entities → Sub-zones, then draw them in Mapping → Sub-zones. Rooms, positioning and calibration are unchanged.
- **Hold the room through short gaps.** When a device comes back after a short gap in its signal, the panel keeps showing the room it had before, marked `room_held`, until the room vote confirms one again. Display only: how rooms are decided is unchanged. Off by default: Settings → Hold Room Through Short Gaps (up to 600 s).
- **Why this room.** Each area sensor can carry a `room_reason` attribute: the votes won and needed, whether the anti-teleport gate is holding a move back, whether the current-room bias kept the room, and the top room scores. Off by default: Settings → Why This Room.
- **Apple RoomPlan import.** The Rooms tab's floor plan import also takes a RoomPlan scan exported as JSON, beside Sweet Home 3D: floors (or walls) become room outlines and labels become room names, as a candidate to review and commit, like an .sh3d import. Off by default: Settings → Features → RoomPlan Import.
- **Ask Assist which room someone is in.** "Which room is Alice in" answers "Alice is in the Kitchen" straight from PadSpan, where Home Assistant's own answer often says "at home". It does nothing until you add the custom sentences shown in [Getting Started](docs/GETTING_STARTED.md); it only reads.
- **Import from a robot vacuum.** In Mapping, the Rooms card's **Import from a robot vacuum** reads a Valetudo map (a file, the robot's address or its map camera), previews it and adds it as a new map with its rooms and dock; it never overwrites a map, and rooms that already exist are skipped. The live robot on the map and a calibration walker are off until you turn them on, and the walker's points wait in a review pile until you accept each one by hand.

### Fixed
- **Wall screens, since 0.38.159:**
  - A portrait wall opens on the whole house, not a phone's room-sized view, and pressing All after Live Aboard opens on a floor shows the whole house again instead of jumping to an old close-up.
  - Buttons stop growing at finger size (about 22 mm on the glass) while the text keeps growing for the room; on a big touch wall they had grown to about 6 cm.
  - No lights table under the map on a wall (it gave the page a scrollbar), and the full-height layout now allows for tablets' browser bars.
  - High quality, picked by hand, draws the 3D house at full resolution on a wall (Auto keeps its lighter budget).
  - Burn-in protection moves Live Aboard's full screen too and never makes the page scroll; leaving full screen clears it.
  - The first touch on a faded wall only wakes it, and only where a hidden control was: the rail, drawers and lights work on the first tap.
  - A link for one screen no longer changes every wall; the rain grows with the drawing, not the text; the floor key gives back height it didn't use; a slider whose save fails goes back to its old value.
- **Licence homes:** a backup restore or a Bright import keeps this home's place on the licence, a trial or invite key starts afresh, a factory reset keeps the home count, and a broken answer from the licence server shows a plain error.

### Opt-in report
- The screen counts (`client_screen:*`) now count each screen once per report; they were counted once per page load. A screen is no longer counted twice after a report fails to send.
- With a licence key on more than two homes, the licence's group code (`licence_group`): a short code made from the key, never the key, the same in each of that licence's homes so they can be seen together. The code is sent only from a key on more than two homes; a house with one or two sends what it always did.
- Errors in the new heatmap, Trails, director and robot vacuum import code are counted by name like the rest of the panel's (`ui_error:*`).
- Which of this version's new switches are on (Alert pulse, light colours, sub-zones, why-this-room, RoomPlan import, Fully Kiosk, room hold, floor cycle, director), sent only when one is on, so a house that never turns them on sends what it always did. And how often a room is held through a gap (`room_hold_used`), a robot vacuum's map is imported (`vacuum_imported`) and a walker point is accepted into calibration (`vacuum_point_accepted`).

---

## 0.38.159 — Wall screens sized for the room, and a card to tune them (2026-10-21)

### New
- **Settings → UI Structure → Wall screens.** One card to set up a wall screen (`?kiosk=1` on the sidebar Atlas). Leave it on **Size from the screen** and a 4K wall draws everything twice its 1080p size, as in 0.38.158. Or choose **Size for my room**, pick a preset (desk monitor, kitchen tablet, hallway screen, living-room TV, big TV) or set the screen's size and how far away people stand, and PadSpan works out the text size the way control rooms do: by how big it looks from where you are, not by pixels. A **Text size** slider (Small to Very large) goes on top. A to-scale preview of a 4K screen and a side view of the room show the result, with the text's height in centimetres. Wall screens pick up a change within half a minute.
- **A link for one screen.** The card builds a link like `/padspan-lights?kiosk=1&wall_in=55&wall_m=2.5` with a Copy button; a screen opened with its own link keeps its own size whatever the house setting is, so the hallway and the living room can differ.
- **Dim at night.** Up to 70% darker between sunset and sunrise (needs Home Assistant's Sun).
- **Burn-in protection.** For OLED and plasma walls: the picture moves a few pixels every few minutes.
- **A wall shows the house, not its buttons.** The controls floating over the map and the 3D house fade out 30 seconds after the last touch, mouse move or key, and come back with the next one. The fixture shapes key is left off a wall.
- On a wall sized for its room, the flat Atlas's room names and its floor key grow with it (a small room's name still shrinks to fit inside it), and in Live Aboard the readout chips and the names of tags and people grow too. Full-screen 3D keeps the wall's size, and a big wall's 3D house is drawn at a resolution the graphics card can keep up with.

### Opt-in report
- The screens PadSpan is shown on, in broad buckets: resolution (`res_*`), portrait or landscape, pixel density, the kind of screen, how many monitors, and how many different screens (`client_screen:*`, `client_screen_seen`). Each screen is counted once by a random id that stays on your Home Assistant; only the count is sent.
- On a wall: whether it is sized from the screen or for the room (`wall_fit:*`), and the scale (`wall_ui:*`, now up to 6).

---

## 0.38.158 — 4K wall mode, a room that rises past its floor, and rain beside a smaller upstairs (2026-10-21)

### New
- **4K wall mode.** Open the sidebar Atlas as `/padspan-lights?kiosk=1` and it becomes a wall screen: the whole house fits on the screen, every floor top to bottom, instead of running off the bottom; the header goes; and the rail, the legends, Live Aboard's bars and room names, and the rain grow with the screen, so a 4K wall reads from across the room. On a 1080p screen everything stays its usual size, but the house now fits too. The screen is kept awake while the page is open (over HTTPS, or on the screen's own localhost), and the first-time Live Aboard card, which nobody at a wall would tap, isn't shown. It needs the Atlas's new layout (PadSpan Pro). See the [Wall Screen Guide](docs/WALL_SCREEN_GUIDE.md).
- **A room can be taller than its floor.** A double-height living room, or a hall under a gallery, no longer needs the whole floor made tall. In Mapping → Atlas, choose Rooms, select the room, and set **Rises to (m)**: how high its space goes above its floor (1.5 to 30 m). Leave it blank and the room is as tall as its floor, exactly as before. In Live Aboard the room's walls rise to that height, it is roofed at its own height, a gallery or loft edge over it gets its glass railing, and its lights hang from its own ceiling. Positioning is unchanged: it still reads the floors' heights.

### Fixed
- **Rain beside a smaller upper floor.** The Atlas joined two stacked floors into one outline for its rain mask, so with an L-shaped upstairs, a one-storey wing or a detached garage, no rain fell in the open air beside it. Each part of the upper floor is now joined to the floor below on its own, and a plain box house is masked exactly as before. Rain also stays lined up when floors are spread apart with Spacing.
- **Floor plans load even if one couldn't be moved.** If moving the floor plans out of Home Assistant's public folder failed (0.38.143), PadSpan stopped loading maps at all. It now logs the problem, leaves that picture where it was, and loads everything else.
- **A backup restore keeps a map whose picture is missing.** A map whose picture couldn't be saved into the backup used to be lost on restore, with its rooms, calibration and pins. It now comes back without a picture, and Replace Image puts one back. A backup that can't fetch a picture asks for fresh links once and tries again, and says which maps still have none.
- **An update no longer reloads a wall screen over your work.** The panel waits while a dialog is open, a calibration pin or map is being dragged, or Maps is on Upload, Edit or 3D Stack, and tries again later. The Atlas shown as Overview leaves the update check to the panel.
- **Coming back to PadSpan keeps your theme and panel style.** Leaving the panel and coming back could leave Day or a palette half applied, or the 2025 style missing.
- **Show HA reads right from the start** when Home Assistant's sidebar was already hidden.
- **Maps for people who aren't admins:** no Upload tab, Trim or Rotate they can't use, and errors show their message instead of "[object Object]".
- A gallery's walls no longer flicker where they meet the hall's in Live Aboard.
- Cropping and extending a floor plan no longer pauses Home Assistant while the picture is processed.
- **The Atlas's map no longer loses its right edge.** On the Atlas's new layout the map ran about 20 px past its card, so the right edge of a drawing as wide as the screen (on a phone, a tablet, a portrait screen) was cut off. It now ends with the same margin as on the left; the drawing is about 1% smaller for it.

### Opt-in report
- Which theme the panel wears (Day, Light or a palette), and how many rooms have their own height.
- On a wall: the scale it runs at, and whether the screen is being kept awake (`wall_ui:*`, `wall_awake:*`).
- A mezzanine is now counted only where its rooms really stand over a taller room below; one set up with floor heights alone, with no rooms drawn upstairs, isn't (`house3d_mezzanine`).

---

## 0.38.157 — Stable: mezzanines in 3D, one look for the Atlas and Live Aboard, and more themes (2026-10-20)

- **Coming from 0.38.144?** This stable brings in everything from the 0.38.145–0.38.156 betas below:
  - **Mezzanines and open edges in Live Aboard:** an Open (Loft) edge over a hall that rises past it shows as a glass railing, a mezzanine inside a tall hall sits under the hall's roof, and LED strips can follow a mezzanine's railing.
  - **The Atlas and Live Aboard match the rest of PadSpan:** the same buttons, text colours and sizes, ✕ to close, and one set of glass, borders and shadows for the 3D house's floating controls. In the Day theme, the Atlas card and its tools in Mapping are readable.
  - **Themes:** Settings → Appearance → Theme offers Night and Light (inverted) to everyone, and Day, Graphite, Ocean, Dusk and High contrast with PadSpan Pro.
  - **Hide HA:** a button beside Toggle, and on the sidebar Atlas beside Refresh, hides Home Assistant's own sidebar on that browser and brings it back as it was.
  - **Wall screens catch up after an update by themselves**, `?view=` links open the view they name, and the update note names the last version anyone looked at.
  - **Smoke, gas and CO alarms aren't weather warnings**, so the Atlas finds real weather warnings on its own again.
  - **The opt-in report** says which country and language Home Assistant is set to, what kind of screen PadSpan is on, and whether railings, mezzanines and Hide HA are used.

### Fixed
- **Day theme no longer turns some text back to light on a light card.** When a view changed an element's style after it was drawn (hiding it, resizing it), the Day theme took its day colours for night ones and turned them back; switching back to Night could also leave day colours behind until the next redraw. Each colour is now changed once.
- The Day theme does less work on a page that changes often, and a wall left on it for days no longer slowly holds on to old stylesheets.
- **On PadSpan Bright**, the themes that need PadSpan Pro are not shown greyed out; Bright shows Night and Light, as it did before.
- **Show HA stays on a phone or narrow tablet while Home Assistant's sidebar is hidden**, so there is always a way to bring it back.
- On the sidebar Atlas, Refresh keeps its place on a phone.
- The What's New panel now holds the last fourteen releases, so going from one stable to the next shows every step.

---

## 0.38.156 — The extra themes are PadSpan Pro's (2026-10-20)

### Changed
- **Graphite, Ocean, Dusk, High contrast and Day come with PadSpan Pro.** Without Pro they show greyed out in Settings → Appearance → Theme, with a line pointing to Settings → Features → PadSpan licence. **Night and Light (inverted) stay in every edition**, so the accessibility inversion never needs a licence. An install that was using Day without Pro goes back to Night; the choice is kept, and comes back with a Pro key.

---

## 0.38.155 — Show HA on the sidebar Atlas too (2026-10-20)

### New
- **The sidebar Atlas has Hide HA / Show HA too**, beside Refresh, so with Home Assistant's sidebar hidden there is a way back from the Atlas as well as from PadSpan. It is the same switch as PadSpan's (0.38.153), on that browser only, and not offered on a phone. The panel and the Atlas now share one copy of it.

---

## 0.38.154 — Four more themes: Graphite, Ocean, Dusk and High contrast (2026-10-20)

### New
- **Settings → Appearance → Theme has seven choices.** Beside Night, Light (inverted) and Day:
  - **Graphite**, **Ocean** and **Dusk** are Night in neutral charcoal, deep navy or plum. Every surface and text keeps Night's lightness, so they read exactly as well; only the tint changes.
  - **High contrast** is black with white text and solid light edges on every card, button and field, for eyes that need it.

  All four keep PadSpan's green accent and every colour that means something (alarms, warnings, tracking blue). Maps, charts, the 3D house and Pure Live keep their night colours, as with Day. Light and Day are unchanged.

---

## 0.38.153 — Hide Home Assistant's sidebar from PadSpan (2026-10-20)

### New
- **Hide HA, beside Toggle.** A button in PadSpan's toolbar hides Home Assistant's own sidebar, and gives PadSpan the whole screen. It reads **Show HA** while the sidebar is hidden, and brings it back as it was, docked or automatic. It's Home Assistant's own setting (Profile → "Always hide the sidebar"), so it holds on that browser only, through reloads, and your phone and other screens keep theirs. The button stays on the collapsed menu too, so the way back is always there. It isn't offered on a phone or a narrow tablet, where Home Assistant's sidebar is a drawer anyway. The sidebar Atlas has no button of its own yet: with the sidebar hidden, go back through PadSpan, or Profile in Home Assistant.

### Opt-in report
- Counts the sidebar hidden and shown again from PadSpan (`ha_sidebar:hidden`, `ha_sidebar:shown`).

---

## 0.38.152 — The Atlas and Live Aboard match the rest of PadSpan (2026-10-20)

### Fixed
- **In the Day theme, the Atlas's tools above the map are readable.** In Mapping → Atlas, the Atlas card (its title, help and buttons) and the Transform, Place and Spread rows kept their night colours on a light page, so they were almost invisible. They now follow the Day theme like every other card. The map itself, its toolbar and the 3D house stay dark, as before.
- **In the Day theme with the 2025 style, the Atlas's name fields stay dark.** "Type a name to save as…" and "Type a name to set…" turned white on the dark map.

### Changed
- **One look for buttons and text across the panel, the Atlas and Live Aboard.** The main buttons in the Atlas and Live Aboard (Apply, a chosen chip, the furniture library's Place and Share, the 3D card's button, WLED's main button) are the panel's deep green with a green edge instead of a brighter gradient. Text uses the panel's colours, links are green rather than blue, and text sizes are whole pixels with 10 px the smallest, as in the rest of the panel since 0.38.150.
- **The 3D house's floating controls are one family.** Its bars, menus, sheets, toasts and cards had drifted to eight shades of glass and a handful of borders and shadows; they now share three glass strengths, three border strengths and two shadows, and faint grey-green text is the panel's muted grey, easier to read over a busy scene. The Atlas's pop-up sheets and toolbars use the same values, and Undo's amber is the panel's.
- **Close is ✕ everywhere.** Live Aboard's sheets and cards used ×, the Atlas and the panel ✕.

The map and 3D drawings, light colours, the coloured mode buttons and Pure Live are unchanged.

---

## 0.38.151 — A Day theme, beside Night and Light (2026-10-20)

### New
- **Settings → Appearance → Theme now offers three choices: Night, Light (inverted) and Day.** Night is the dark forest green you know. Light is the same colour inversion as before, unchanged, for anyone who can't use a dark screen; it just moved here from Settings → Presence. Day is new: the whole panel redrawn in light colours, with pale surfaces, dark text and the same green accent, in both the Classic and 2025 styles. Maps, charts, the 3D house and Pure Live keep their night colours in Day, so what they show reads the same either way.

### Fixed
- A panel whose settings arrived on a full refresh did not show its chosen panel style (Classic or 2025) or theme until a setting was changed. Both now follow every settings read.

---

## 0.38.150 — One look across the panel (2026-10-20)

### Changed
- **The panel's colours match from tab to tab.** Settings, Overview, Manage, QA, Calibration, Follow, Traceback and the other tabs had picked up cold blue-grey boxes, borders and dropdowns over the years; they now use the same dark forest greens as the rest of the panel. Checkboxes, radio buttons and sliders are green instead of the browser's blue, in the panel and on the Atlas. Greens that were nearly the same colour are now one accent, one "good" green and one light green, and grey hint text is the same grey everywhere.
- **Text sizes snap to one scale.** Half-pixel sizes are rounded to whole pixels, and the smallest 9 px labels are now 10 px so they can be read.
- Blue still marks phone tracking and the calibration target (the blue spiral), and maps, charts, the 3D house and Pure Live are unchanged.

---

## 0.38.149 — Wall screens in the opt-in report (2026-10-20)

### Opt-in report
- **Wall screens.** Once per page load, the main panel and the sidebar Atlas say what kind of screen they are on: opened with `?kiosk=1`, filling the screen and untouched for two minutes, filling the screen and in use, or an ordinary window. A wall screen that reloaded itself after an update (0.38.145) says whether it came back on the new version or the old one. This shows whether those wall-screen fixes work in real houses and whether the full-screen rule mistakes desktops for walls.
- **`?view=` links.** Whether a link that opens a view stayed on it, or went back to the menu because Forensics is off or the edition has no such view. Never the link itself.

---

## 0.38.148 — Country and language in the opt-in report (2026-10-20)

### Opt-in report
- **The report now includes the country and language set in Home Assistant** (Settings → System → General): a two-letter code such as `CA` and a language tag such as `en-GB`, so we can see where PadSpan is used and which translations to do first. Either one is left out when blank, and neither is ever worked out from your IP address. If you've already opted in, this goes with your next report; Preview in Settings → Presence → Help improve PadSpan shows it, and switching the report off stops it.

---

## 0.38.147 — Mezzanines and open edges in Live Aboard (2026-10-20)

### New
- **An open edge over a drop gets a railing.** A wall drawn with the Open (Loft) material along a mezzanine or gallery now shows in Live Aboard as a 1 m glass railing, where it looks out over a hall that rises past it: a lower floor at least 76 cm down (the drop at which building codes ask for a guard) whose height in Floor Heights reaches above the mezzanine. Anywhere else (between two rooms on one floor, over an ordinary storey below, or over nothing) it stays an open gap as before, so an Open doorway upstairs never grows a railing. The railing is still an opening: no wall lights hang on it, and the signal through it is unchanged. Explode, Cut and Down show it too.
- **LED strips can follow a mezzanine's railing.** The strip tool's **Along a rail** is offered for a mezzanine as well as a deck, and lays the strip on the rail's top.

### Fixed
- **A mezzanine inside a tall hall is drawn under the hall's roof.** With the hall given its full height and the mezzanine its real base elevation (Mapping → Floor Heights), Live Aboard put a second roof on the mezzanine halfway up the hall and left the hall roofed only over part of it. The hall now gets one roof, and the mezzanine is roofed only where it reaches past the hall. Ordinary stacked floors are unchanged.

### Help
- Floor Heights, the wall material help, the Live Aboard guide and the Walls Guide explain how to set up a mezzanine and its open edges.

### Opt-in report
- Counts a house that has a railing over a drop (`house3d_loft_rail`) and one with a mezzanine inside a taller floor (`house3d_mezzanine`), so we can tell whether these houses show up.

### Testing
- The Live Aboard harness has a hall with a mezzanine (`?gym=1`) and open edges on the sample house (`?loft=1`), and finds a free port by itself when 8765 is taken.

---

## 0.38.146 — Smoke, gas and CO alarms aren't weather warnings either (2026-10-19)

### Fixed
- **Settings → Outdoor weather → Weather warnings no longer offers a smoke, gas or CO alarm.** Water-leak detectors were left out of that list in 0.38.94, but Emergency has since learned smoke, gas and CO alarms (0.38.135), and one named like a warning ("Hall Smoke Alert") still showed up. Picked, it stopped the Atlas finding real weather warnings on its own. One already picked is now ignored and Settings says so under the list, as it did for a leak detector: pick a warning there, or Automatic.

### Opt-in report
- An alarm set aside like that is counted the same way a leak detector already was (`weather_note:warning_ignored`).

---

## 0.38.145 — Wall screens catch up after an update, and links open what they name (2026-10-19)

### Fixed
- **A wall screen left on the Atlas now reloads itself after an update.** The sidebar Atlas never checked which version Home Assistant was running, so a wall left on it kept showing the old Atlas until someone reloaded it by hand (found on a real wall screen today, still on 0.38.105 hours after the update). It now checks every 10 minutes, as the PadSpan panel does, and a wall screen reloads once for each new version.
- **A full-screen window counts as a wall screen.** A browser in kiosk mode or full screen reloads itself after an update, as a `?kiosk=1` link already did, once nobody has touched it for two minutes (it may be a tablet somebody is using). Until then it shows the Reload bar.
- **`?view=` links open the view they name** ([#93](https://github.com/gbroeckling/padspanHA/issues/93)). `?view=forensics`, `monitor`, `bluetooth` and `presence` landed on Overview, Forensics even when it was switched on. A link now stays on its view, unless that view isn't there: Forensics while it's off, or a view your edition doesn't have.
- **The update note says what its version really is** ([#94](https://github.com/gbroeckling/padspanHA/issues/94)). "This install was on v0.38.89" named the last update anyone opened or dismissed the note for, not the version installed before. It now says "The last update anyone here looked at was v0.38.89", and the release notes still cover everything since.

### Testing
- One command for the whole test pass on Windows or macOS: `python tools/test_all.py` runs the suite, the 14 Live Aboard browser checks and, with a Home Assistant address and token set, a read-only check of a live install ([#97](https://github.com/gbroeckling/padspanHA/issues/97)).
- The Live Aboard browser checks run on a Mac in Chrome, say why when the 3D view doesn't start instead of waiting on a button that never comes, and fail when they find a problem instead of only printing it ([#95](https://github.com/gbroeckling/padspanHA/issues/95)). They can also run in another machine's browser, such as a wall screen's, on its own graphics.
- The test suite no longer prints "coroutine was never awaited" warnings from its own stand-ins, so a real one would stand out ([#96](https://github.com/gbroeckling/padspanHA/issues/96)).

---

## 0.38.144 — Stable: floor plans only for people logged in, and a faster PadSpan with Bermuda (2026-10-19)

- **Coming from 0.38.135?** This stable brings in everything from the 0.38.136–0.38.143 betas below:
  - **Floor plans are private:** they move out of Home Assistant's public `www` folder by themselves on the first start and are shown only to someone logged in. Uploading or replacing one needs an admin. If you go back to 0.38.135 or older afterwards, floor plans show blank until you update again; nothing is lost.
  - **The Atlas as Overview** (Pro option), and **Set up Live Aboard step by step**, a guide through floors, heights, walls, doors, lights and making it your screen.
  - **Min signal per receiver** (Bluetooth → Scanners) for a receiver that hears the street or the neighbours, and **Quieter** in Find the one in your hand.
  - **Atlas rain** that doesn't fall on a sunny morning when only dew wets a rain sensor, or between stacked floors, or over the rooms in Live Aboard.
  - **💡 Suggest an idea**, in Settings and at the bottom of What's New.

### Fixed
- **Home Assistant 2026.10 and Bermuda:** every snapshot build read a property Home Assistant 2026.10 marks as old, once for each device in the registry. Each read now costs Home Assistant about a millisecond to note who made it, so a house with Bermuda and a few thousand devices lost 1 to 4 seconds a build, with Home Assistant frozen meanwhile. PadSpan reads the new field instead, there and in the receiver sync and the receiver and phone lists.
- **Min signal per receiver** no longer changes what a pinned beacon saves as a calibration point. The faint readings it keeps out of positioning still go into calibration, as before the setting existed.
- On PadSpan Bright, the "Atlas as Overview" switch is gone where Bright has no Overview, and Set up Live Aboard's last step no longer waits for it.
- Set up Live Aboard's "open this tool" no longer waits for a later visit on a screen that can't draw 3D.
- The Suggest an idea card isn't shown on a wall screen, which couldn't close the tab it would open.

### Opt-in report
- The registry sizes are counted only while the report is on.

---

## 0.38.143 — Floor plans only for people logged in (2026-10-19)

### Security
- **Fixed:** uploaded floor plans were saved in `/config/www/padspan_ha/maps/`, and Home Assistant serves everything in `www` at `/local/` without a login. On an install reachable from the internet, anyone with the address could open a home's floor plan. They now live in `/config/padspan_ha/maps/` and are served only to someone logged in to Home Assistant, the same way camera snapshots are. Thanks to @frenck for spotting it in the HACS review.
- **Moved for you:** on the first start of this version, existing floor plans move out of `www` by themselves. Nothing is overwritten: if a file of the same name is already in the new folder, the old one is left in place and the log says so. Placements, rooms, pins and calibration don't change.
- **Changed:** uploading or replacing a floor plan now needs an admin account, like deleting one already did. Everyone can still see them.
- **Going back:** if you install 0.38.142 or older after this, floor plans show blank until you update again, because the older version looks for them in `www`. Nothing is lost. A floor plan replaced while you're on the older version is kept in `www` when you update again, and the log says which: replace it once more after updating.

### Fixes
- **Fixed:** making or restoring a backup, factory reset, and deleting, extending or replacing a floor plan no longer check files on Home Assistant's main loop, which could stall it briefly on a slow SD card.

### Opt-in report
- **Added:** how many floor plans this version moved out of `www`, how many it had to leave, and how often a floor-plan link was refused for being out of date.

---

## 0.38.142 — Atlas rain: not on a sunny day, not inside the house (2026-10-19)

### Fixes
- **Fixed:** the Atlas no longer shows rain on a sunny morning. An on/off rain sensor that reads wet while the weather entity says sunny, clear or partly cloudy is wet from dew or frost, so it's ignored. A rain-rate sensor, a rain gauge, or an on/off sensor a helper makes from one (a template or a threshold) still counts: what it caught really fell.
- **Fixed:** for the same reason, a window left open on a sunny morning no longer glows blue in Live Aboard as if it were open in the rain.
- **Fixed:** rain no longer falls in the space between two stacked floors on the Atlas. That space is inside the house, so the floors and the space between them now stay dry and rain falls only around the building. An outdoor floor drawn between two indoor ones keeps its rain.
- **Fixed:** in Live Aboard, rain is no longer drawn over the house. Drops falling outside, in front of the house, showed over sofas, beds and walls; now nothing falls across the house on screen. With the roof on, rain falls in front of it as before; with the walls down, the rooms stay dry up to head height and the ground beyond still gets rain.
- **Fixed:** a water-leak detector picked as the weather warnings sensor, before that list left them out, is now ignored, and the Atlas finds warnings itself. Settings → Outdoor weather says so under the list: pick a warning there, or Automatic.

### Opt-in report
- **Added:** it counts how often a clear sky overrules a wet rain sensor, and whether a leak detector is still set as the warnings sensor.

---

## 0.38.141 — Polish (2026-10-17)

### Fixed
- Overview's People in building card said "undefined people" when the estimate hadn't come in (an older backend or a failed read); it shows a dash now.
- The Live Aboard setup wizard sits centred in its window instead of hugging the left with Next floating mid-way.
- Suggest an idea's buttons match the other buttons on the page.

---

## 0.38.140 — Suggest an idea (2026-10-17)

### New
- **💡 Suggest an idea**, in Settings (above Help improve PadSpan) and at the bottom of What's New: post an idea on GitHub Discussions → Ideas, where other people can vote on it, see and vote on the ideas already there, or email one to hello@traks.ca if you'd rather not use GitHub. Not shown on a wall screen.

### Opt-in report
- Which of the three ways people take (posted, browsed, emailed). Nothing about the idea itself.

---

## 0.38.139 — A minimum signal per receiver, and find a device by hiding it (2026-10-17)

Both are options: nothing changes unless you use them.

### New
- **Min signal, per receiver** (Bluetooth → Scanners, on each receiver's row; off unless you set it). A receiver on an outside wall, or on a floor above a shop or a flat, hears the street and the neighbours. Pick **Ignore < -90** (or -95 to -70) and that receiver ignores anything weaker, for **positioning and Occupancy's phone count only**. The scanner and advert lists, Forensics, Traceback, Find My following and calibration still see every reading. A phone in the room reads far stronger than that at the nearest receiver, so it isn't lost. The Walls Guide and the Unknown phone help explain when to use it.
- **Find the one in your hand: Louder or Quieter.** Louder is as before: hold it against the receiver. **Quieter** is new: start with the device near the receiver, then hide it in a metal bin or a saucepan with a lid; whatever went quiet (or silent) comes up, ready to tag. Handy for checking a guess too.

### Opt-in report
- How many receivers have a minimum signal, and how many readings it keeps out each poll.

---

## 0.38.138 — Set up Live Aboard step by step (2026-10-17)

### New
- **The Live Aboard setup wizard** (PadSpan Pro): **✨ Set it up step by step** in Settings → UI Structure → Live Aboard, or **🏠 Set up Live Aboard** at the top of Mapping → Atlas. Ten steps build the 3D house from scratch: turn it on, floor heights (set right in the wizard), rooms, devices on the Atlas, heights, doors and windows, LED strips, furniture, the extras, and making it your screen. Each step says what it found in your house (which floors have no height, which door and window sensors aren't on a door or window yet, which lights look like strips and aren't laid out) and opens the right tool for the rest.
- **It takes you straight to the tool.** "Open Live Aboard at Heights", "Draw a door", "Draw a window" open Live Aboard in Mapping → Atlas with Edit already on that tool. Every door or window sensor that isn't on a door or window yet has its own **Draw its door** / **Draw its window**, and every light that looks like a strip has **Lay it out**, which opens Strip with that light picked. While you're out, Mapping → Atlas has **← Back to the setup wizard**, which checks again what's done.
- Every optional setting is in it, so nothing cool stays hidden: look, quality, outdoor weather and rain and snow, show people, tags and scanners, the shared furniture library, furniture from a photo (AI Task), back to home view, and the **Show the Atlas as Overview** switch (off unless you choose it). It opens on the first step that isn't done, and you can come back any time.

### Opt-in report
- The wizard opened, and finished.

---

## 0.38.137 — The Atlas as Overview (Pro option) (2026-10-17)

### New
- **Show the Atlas as Overview** (PadSpan Pro, off unless you turn it on): in **Settings → UI Structure**, a new switch makes Overview, the first tab, show the Atlas (the same screen as the Atlas in the sidebar, with Live Aboard if it's on) instead of the classic map. The classic Overview isn't gone: **Pure Live** gets a **⚡ Pure Live | ▦ Overview** switch at the top while this is on. Turning it off puts everything back.

### Opt-in report
- Whether the option is on, and which side of Pure Live's switch people pick.

---

## 0.38.136 — Faster snapshot builds in houses with many same-named devices (2026-10-16)

### Fixed
- Matching each receiver to its Home Assistant device took longer the more devices shared a name, and it ran on every snapshot build. 4,000 same-named devices cost 1.5 seconds a build, during which Home Assistant was frozen. It now takes a few milliseconds whatever the count.

### Opt-in report
- The size of Home Assistant's device and entity registries, and the most devices sharing one name. Some Bermuda houses spend 3 to 16 seconds per build in this part, and this shows whether that shape is why.

---

## 0.38.135 — Stable: Live Aboard grows up, one name per receiver, smoke and CO alarms (2026-10-16)

- **Coming from 0.38.124?** This stable brings in everything from the 0.38.125–0.38.134 betas below:
  - **Live Aboard (the 3D house):** motion that reads at a glance (only "now" is lit, with lines down to the floor), Explode to see every floor at once, a heat map with Temps, a warning for a window left open in the rain, lit windows at night, the room sheet's own scenes and scripts as ▶ buttons, and smoother building tools (5 cm snapping, keyboard shortcuts, one-tap Round this room).
  - **Emergency** covers smoke, gas and CO alarms as well as leaks.
  - **One name per receiver** everywhere (your Home Assistant name for it), **Find the one in your hand** in Bluetooth → Scanners, and **Custom walls** that take your own dB.
  - **Guides:** Live Aboard, Furnish, Wall Screen, PadSpan Pro and Walls, and a much fuller Atlas Guide.
  - Free-Pro offers can be switched off from the server, and the opt-in report says more (counts only).

### Fixed
- Live Aboard: an open window's rain glow drew as a floating box where Cut had lowered the wall, and didn't follow the walls as the view turned.
- Live Aboard: after switching to the flat map and back, the "window open in the rain" line could stay blank, and the old heat map stayed in memory.
- Live Aboard: **⇕ Explode** is in the floor list too, so it can be reached on a phone, where the ⇕ button is hidden.
- Tester sign-up: a slow licence server could make Home Assistant say the sign-up failed when it had gone through and the key had been sent.

### Opt-in report
- A day with more kinds of event than fit no longer stops the report: the rarest counters are left out instead, and it says how many.
- Positioning steadiness is only worked out while the report is on.
- A receiver is counted under one kind only.
- "Tag pressed from Walk-to-Identify" counts only presses on its candidates.

---

## 0.38.134 — More in the opt-in report (2026-10-16)

Nothing changes in how PadSpan works. The opt-in report (Settings → Presence → Help improve PadSpan) says more, still as counts and buckets only: no names, addresses or entity ids.

### Opt-in report
- **Where a slow snapshot build goes.** The reports show one part of the build (going through Home Assistant's states and registries) taking 90% or more of the time on every slow install, up to 16 seconds, and only where Bermuda is installed and not ignored. The report now carries that part's CPU time next to its wall time (is it PadSpan's own work, or Home Assistant too busy to give it the processor?), its three pieces, and p95 for every part.
- **How steady positioning is**, for your own (identified) devices only: room changes per hour, the share of the time with no room, and how many receivers hear each one. The report's first measure of whether positioning is any good.
- **Receivers:** Tasmota counted apart, and where each receiver's name comes from (your HA name, HA's, the scanner's own, its area, or only its MAC).
- **Occupancy:** how many Unknown phones each estimate counts, and its confidence.
- **Walk-to-Identify:** "Who's here?" pressed, and Tag pressed on one of its candidates.

---

## 0.38.133 — Free Pro offers can be switched off from the server (2026-10-16)

### Changed
- **The update notification mentions the tester offer.** While it's running and no licence key is entered, the "update available" notice has one line: testers get PadSpan Pro free for two years.
- **Offers that have ended disappear on their own.** The daily update check's answer can now switch the free-Pro offers (becoming a tester, and invites) off or back on, so an ended offer leaves the panel without an update. It only carries those two on/off switches and can't add anything. The README's Updates & Privacy section says so.

### Opt-in report
- Counts whether the free-Pro cards are seen and what's done with them: an invite shown, put off, claimed or declined, and the "test it, get Pro free" card shown or turned down. Never who.

---

## 0.38.132 — One name per receiver, find the device in your hand, walls explained (2026-10-16)

### New
- **Find the one in your hand.** In **Bluetooth → Scanners**, pick a receiver and press **Start** with the device a few metres away. Then hold it right against the receiver for about 20 seconds. Whatever got louder comes up with how much it jumped and a **Tag** button. Easier than hunting through thousands of unnamed devices. (Most TV and air-conditioner remotes are infrared and send no Bluetooth, so they won't show.)
- **Custom walls take your own number.** In the map editor's RF Barriers, pick **Custom** and a **Loss through it** box (0–30 dB) appears. Under the material list there's a short note on what the numbers mean and a link to the new **Walls Guide**.
- **Walls Guide** (docs/WALLS_GUIDE.md): where PadSpan's wall numbers come from (they're round starting points, and Custom 6 dB is the "don't know" wall), real-world ranges for drywall, brick, concrete, plaster on wire lath, coated glass and metal, and how to tell a wall is drawn too weak or too strong.
- **Unknown phone** in Occupancy's Counted list has a **?** that says what it is (a phone changing its Bluetooth address) and what to do if it's yours, a visitor's or a neighbour's.

### Fixed
- **Each receiver now goes by one name everywhere.** It used to show as its HA area in one place, the scanner's own name with its MAC in another, "Room scanner (D7:1E)" in Live Aboard, and the bare MAC in others. Now it's the name you gave the device in Home Assistant, else HA's device name, else the scanner's own name without the MAC. Shown in Bluetooth, Monitor, Overview, Calibration's Live Radios, Settings, Presence, the Atlas radio list, scanner details and Live Aboard. Shelly and other proxies that only showed a MAC now show their HA name.
- A door cut into a Custom wall kept 6 dB instead of the wall's own number.

### Opt-in report
- Find the one in your hand: `hold_near_started`, `hold_near_found` (something got louder) and `hold_near_tagged` (Tag pressed on one).

---

## 0.38.131 — Smoke, gas and CO alarms join Emergency (2026-10-15)

### New
- **Emergency now covers smoke, gas and carbon monoxide alarms**, not just water leaks. Place one on the Atlas like any device. When it goes off it latches and alarms exactly as a leak does: alarm rings across its room, the banner on every PadSpan page until you reset it, and a red word over Live Aboard. Each says what it found (**SMOKE**, **GAS**, **CO**, or **WET** for a leak), **ALARM** while latched, and **CLEAR** (or **DRY**) when quiet.
- An alarm is drawn as a round detector, a leak sensor still as a puddle. In Live Aboard a smoke alarm sits on the ceiling by default and a gas or CO alarm on the wall, with matching one-tap spots in Heights.

### Opt-in report
- Placed smoke, gas and CO alarms are counted on their own (`alarm_sensor`), apart from leak sensors.

---

## 0.38.130 — Guides for everything new (2026-10-15)

### New
- **New guides:** the [Furnish Guide](docs/FURNISH_GUIDE.md) (furniture, devices and people in the 3D house), the [Wall Screen Guide](docs/WALL_SCREEN_GUIDE.md) (kiosk links, full screen, going back home by itself) and [PadSpan Pro](docs/PADSPAN_PRO.md) (the trial, keys, becoming a tester, invites).
- **The Atlas Guide** now covers heights, room sheets and scenes, ◎ Find active, the emergency lighting test, WLED Advanced and Exact look, and building openers, locks and lights from relays. **Getting Started** covers Tasmota BLE scanners.
- **The Live Aboard Guide** ([docs/LIVE_ABOARD_GUIDE.md](docs/LIVE_ABOARD_GUIDE.md)) covers turning it on, getting around, what the motion badges, colours and lines mean, the heat map, room scenes, and building doors, windows, heights and strips.
- In Live Aboard, **Views ▾ → How it works** brings back the first-time card, which now links to the full guide.

### Fixes
- **Fixed:** Follow's Movement Alerts said "Email me when…" and its help said alerts were email-only. Alerts go to your phone (pick it under Notify service, no email needed) or by email; the card and its help now say so, with Send Test and the arrive and leave events explained.
- **Fixed:** the help for Monitor's Diag Export now says to press **Build export**, and the Objects help explains the 📍 last-seen line (Lost & Found).

### Opt-in report
- The README now lists everything the report has said about Live Aboard: whether it opened or fell back to the flat map, the open-window alert, and the temperature-freshness counts added in 0.38.127.

---

## 0.38.129 — Live Aboard's building tools, smoother (2026-10-15)

### Changed
- **Doors and windows snap to 5 cm** as you draw them or drag their ends: you get 0.80 m or 1.60 m, not 1.59 m. A corner or another door still stops the line where it is.
- **Keyboard shortcuts in Edit:** Ctrl+Z (⌘+Z) undoes, Ctrl+Y or Ctrl+Shift+Z redoes, Escape lets go of what you picked (or a first tap), and Delete removes a door or window you drew. They do nothing while you're typing in a box.
- **Round this room is one tap.** In Strip, a light that's already in a room goes round that room straight away. Tap another room to go round that one instead. Ticking "Leave gaps at doors" or "and windows" changes the run right then.
- While you're editing, the Motion chip and the rain chip step aside, so the tool's hints are never hidden under them.

### Fixes
- **Fixed:** sliding, pocket, barn, bifold and overhead doors showed a swing arc while editing, as if they were hinged. Only doors that swing show one now.
- **Fixed:** a door's sheet cut "Doorway" off as "Do".

---

## 0.38.128 — Scenes in the room sheet, and lit windows at night (2026-10-15)

### New
- **A room's scenes, one tap away.** Tap a room's name and its sheet now lists that room's Home Assistant scenes and scripts as ▶ buttons, next to All lights on and off. It works on the flat Atlas and in Live Aboard.
- **Lit windows at night.** In Live Aboard after dark, a window glows warm while a light is on in the room behind it, the way houses look in the Sims. You see it from outside, with the walls up.

### Fixes
- **Fixed:** in Live Aboard, the Motion chip could sit on top of the house after Top, Fit or Whole house. The house now stays clear of the chips and the buttons.

---

## 0.38.127 — Live Aboard: see every floor, a heat map, and a window left open in the rain (2026-10-15)

### New
- **Explode (⇕, next to All).** Pulls the floors apart so you can see into every storey at once instead of only the top one. Your browser remembers it. Stairs keep their real height.
- **A heat map.** Pick Temps and each room's floor shows its temperature: blue when it's cool, green around 21°, red from 26°, shading in between. °F sensors work too.
- **Window open in the rain.** While it's raining or snowing, any open window glows blue and a line under the Motion chip says which one ("☔ Window open in the rain · Bedroom window"). Tap it to go there. It uses the same rain sensor or weather the Atlas's rain uses, and works even with rain drawing turned off.

### Fixes
- **Fixed:** with every floor showing, a room's name hid whenever a floor above overlapped it on the plan, even where you could see the room. In Explode a name moves to a corner of the room you can see, with its readout under it.
- **Fixed:** on a phone, "Whole house" left no room at the sides, so the house ran to the edge of the screen.

### Opt-in report
- It now counts, for the temperature and humidity sensors on your map, how many are under an hour old by each of Home Assistant's clocks, and how long ago they last reported. That's to check the fix in 0.38.126 holds in real houses. It also counts, once per page, whether the open-window alert ever showed. Counts only, as always.

---

## 0.38.126 — Live Aboard: motion that reads at a glance, and heights you can see (2026-10-15)

### Changed
- **Motion in Live Aboard.** Only a sensor tripping now gets the big lit badge. One that tripped earlier gets a smaller badge ringed in its age colour, and from the whole house you see only the last 40 minutes (pick ☰ Motion to see them all). Each badge has a dashed line down to a ring on the floor, so a sensor on the ceiling shows over its spot in the room instead of looking stuck to the far wall. The room's floor is tinted, not flooded, so you can still tell the rooms apart.
- **Hover a light, a fan or a sensor** that's up off the floor and a dashed line drops to its spot on the floor.
- **Codes no longer pile up.** When two device codes would land on top of each other, the farther one steps aside. Its device still shows and still takes taps.
- **Edit → Heights** has one-tap spots for the device you picked (Ceiling, Corner, Wall, Table and so on, the same as Mapping's Height row), and a line from the device down to the floor shows its height while you set it.
- **The flat Atlas** starts right at the top of the house, with no empty band above it, so zooming in no longer opens on blank space. A motion sensor's rings lie flat on the floor like a light's pool, and a strip's code sits just under the strip.

### Fixes
- **Fixed:** a room's temperature showed "–°" after an hour even while the sensor kept reporting, if the reading didn't change. It now counts a report as a report (Home Assistant 2024.3 and later). The opt-in usage report says whether your Home Assistant gives the panel that.
- **Fixed:** in Live Aboard's Edit, the tool bar no longer sits on top of the "Drag to turn" hint.

---

## 0.38.125 — Atlas touch-ups (2026-10-13)

### Fixes
- **Fixed:** on the Atlas sidebar, the legend under the map no longer slides under the icon rail on the left, which hid the first entry. Hide the rail and the legend moves back to the edge.
- **Fixed:** the Automorph switch in Mapping lights up pink, not brown fading into pink, like the other switches do in their own colour.

---

## 0.38.124 — Stable: two ways to get PadSpan Pro free, and Pro for life until December 31 (2026-10-13)

### New
- **Become a tester, get Pro free.** Testers get two years of PadSpan Pro, as long as the usage report stays on. The sign-up says so now, and Overview mentions it once (after someone is on the map, or after a week), in place of the trial card. "Sign me up" takes you straight to the form in Settings → Presence. Settings → PadSpan licence has a button for it too.
- **Invites.** Now and then the developer may invite an install that sends the usage report to try a free year of Pro. The invite comes back with the report's reply and shows on Overview and in Settings → PadSpan licence, for an administrator only. Claim it with an email, put it off for a week with Later, or say No thanks, which is final. Nothing is sent unless you press one of those. The README's usage report section explains exactly what goes where.

---

## 0.38.123 — PadSpan Pro for life runs until December 31 (2026-10-13)

### Changed
- **PadSpan Pro for life ($89 CAD, once) is on until December 31, 2026**, not October 31. Settings → PadSpan licence and the trial offer say so, and padspan.traks.ca sells it until the same day.

---

## 0.38.122 — Stable: everything since 0.38.105, and what a full review of it found (2026-10-13)

### Before you update
- **Refresh the PadSpan page** in every browser after updating. From now on a wall screen opened with `?kiosk=1` reloads itself after an update.
- **Coming from 0.38.105?** This stable brings in everything from the 0.38.106–0.38.121 betas below: less CPU and memory on busy streets (and a low-memory mode), Traceback recording all day without holding it in memory, alerts that reach your phone, Beacon Tune that saves, Tasmota scanners (experimental), and well over a hundred fixes.
- **Going back to 0.38.105:** delete `.storage/padspan_ha.traceback_segments` first. Traceback now records all day, and 0.38.105 would load the whole week into memory, which can crash Home Assistant on a 2 GB machine.

### Fixes
- **Fixed:** in Beacon Tune, placing a phone, a Find My tag or anything you follow no longer pins it as a fixed beacon. A pin locked it to that room and kept adding calibration points where it no longer was. Beacon Tune now says when it holds one back, and moving a beacon that is already pinned always saves.
- **Fixed:** houses on a busy street no longer re-check every Bluetooth address against every IRK every 5 minutes.
- **Fixed:** saving a map with beacons (Revert migration, restoring a map) can no longer add a calibration point in a "room" that is really an old device label.
- **Fixed:** restoring a backup no longer rolls Lost & Found back. Each device keeps whichever last-seen record is newer.
- **Fixed:** Follow's Test button now fails when the chosen phone or service can't be reached, instead of sending somewhere else and saying it worked. Alerts to Telegram and other non-notify services go out even with no notify service set up. A chosen phone that has since been renamed or removed shows as "(not found)" instead of looking like Auto-detect.
- **Fixed:** Follow alerts to a notify entity all failed when an email address was filled in too.
- **Fixed:** after updating from 0.38.105, Bermuda devices no longer leave frozen copies of themselves in their old rooms.
- **Fixed:** a labelled device's tracker no longer comes back as `device_tracker.<name>_2` when its Bermuda entity goes away.

### Opt-in report
- **Added:** if you've opted in, the report now also counts what shows whether these fixes work in your house: IRK cache clears, calibration points left without a room, Lost & Found restore merges, Follow Test results, old Bermuda objects removed, beacon pins on things that move, and entities registered twice. Counts only, as before.

---

## 0.38.121 — Wall screens that notice updates, and a round of fixes (2026-10-13)

### Before you update
- **Refresh the PadSpan page** in every browser after updating. From this version on, a wall screen opened with `?kiosk=1` reloads itself after an update, and other browsers show a bar with a Reload button.

### New
- **The panel notices updates.** A page left open through an update used to keep running the old version. Now it says so, and a kiosk screen reloads itself once.

### Fixes
- **Fixed:** "Revert migration" no longer deletes the target map's own scanner or beacon when it has the same name as one that came over.
- **Fixed:** Overview's floor Gap and L/R sliders drew every floor faded.
- **Fixed:** a flood alarm's Reset → Yes was wiped by the next update before you could press it.
- **Fixed:** occupancy no longer counts Find My tags as people, and a person tracked by an HA entity is placed in their room.
- **Fixed:** Insights and Busy Times show the most people in a room at one moment, not everyone seen that hour, and fixed beacons aren't counted.
- **Fixed:** Radio Reset now clears the reset scanner's smoothing, Calibration Health shows scanner names, and System Critics' scanner reliability section runs.
- **Fixed:** deleting an area forgets its colour and floor.
- **Fixed:** in the Objects view, room names with "&" show properly, "ALL selected rooms" works, and Clear unidentified clears the screen too.
- **Fixed:** a pending Delete radio confirm in Calibration no longer freezes the other tabs.
- **Fixed:** Escape closes dialogs after you've typed in them, Follow remembers the selected tag after a reload, and a browser that blocks storage no longer gets a blank panel.
- **Fixed:** with rotation bridging on, a labelled tag can no longer take another tag's name.
- **Fixed:** the phone wizard can save an IRK for a phone that isn't advertising right now (Save unverified).
- **Fixed:** Follow's movement log keeps updating while a tag stays selected.
- **Fixed:** Vacation Mode no longer flicks lights on and off all evening. Each light's decision holds for its schedule window and still changes from day to day.
- **Fixed:** buttons that stayed stuck after a failed call (Resume Normal, Delete ALL orphans) come back.
- **Removed:** Mapping's "Re-anchor origin" button, which did nothing.

### Faster
- Less work per update on installs with Bermuda or a busy street: radio network details, the IRK cache, saving the device history and occupancy's phone grouping no longer slow each update down.

### Opt-in report
- After Home Assistant starts, the daily report now waits until it has 6 hours of numbers. Before, it went out after 10 minutes, so it mostly described Home Assistant starting up. An install that hasn't reported for two days still sends after 10 minutes.

---

## 0.38.120 — Tasmota scanners, and no lost setup after a bad disk read (2026-10-13)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### New: Tasmota BLE (experimental, off by default)
- Tasmota devices on an ESP32 (smart plugs, Sonoff switches) can be used as Bluetooth scanners. Turn it on in **Manage → Tasmota BLE** (needs Home Assistant's MQTT integration) and place each one in its room like any other scanner.
- Tasmota's defaults aren't made for room presence. On each device, run `TelePeriod 10`, `BLEMaxAge 30` and `BLEAddrFilter 1` in its console; without the last one, phones and tags that use random addresses are never reported.

### Fixes
- **Fixed:** one failed disk read while Home Assistant starts can no longer replace your rooms, maps, settings (licence key, followed devices, IRKs) or calibration with defaults. The file is left untouched and read again at the next start.
- **Fixed:** one store failing to load no longer stops the others loading.
- **Fixed:** a Bermuda device is one object again. Its Area, Floor and per-scanner sensors each became an object of their own, sometimes in different rooms. This may also be what made snapshot builds slow on some Bermuda installs.
- **Fixed:** Ignore Bermuda now really ignores it.
- **Fixed:** ordinary sensors whose names happen to contain "tag" or "ble" (a kitchen voltage sensor, a dining table occupancy sensor) are no longer tracked as devices.

---

## 0.38.119 — Fixing what the fixes broke (2026-10-12)

A review of the 0.38.106-0.38.118 fixes found bugs those fixes introduced. This release fixes them.

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Presence and alerts
- **Fixed:** a phone set up with the phone wizard no longer "leaves" while it is home when one of its two Bluetooth identities goes quiet. Arrive and leave alerts, events and rules now treat it as one device. Naming or renaming a device that is home doesn't count as leaving and arriving either.
- **Fixed:** changing the away timeout no longer makes everyone arrive or leave at once.
- **Fixed:** a move after a phone was briefly out of range (a minute or two) is reported again.
- **Fixed:** a room alert that comes within a minute of the last one is sent once the minute is up, instead of being dropped.
- **Fixed:** an alert set to a phone that has since been renamed or removed is no longer sent to some other phone or mailbox.

### Home Assistant entities
- **Fixed:** updating no longer creates a second set of entities for some devices. Existing ones keep their names.
- **Fixed:** a device that is still in use can't be deleted from Home Assistant's device page; its entities wouldn't come back until a restart.

### Beacon Tune
- **Fixed:** dragging a phone or tag in Beacon Tune no longer pins it as a fixed beacon.
- **Fixed:** a floor plan that isn't measured yet no longer stays "unsaved" for good in Beacon Tune, and a second placement made straight after the first is saved too.

### Traceback, Lost & Found, backups
- **Fixed:** filtering a Traceback replay to one device finds its history again when nobody is home right now, and long replays keep their newest minutes.
- **Fixed:** Lost & Found records devices you follow without a label again, and keeps the last-seen room of a device away for more than a day across restarts.
- **Fixed:** restoring a backup brings back its working licence key if the one on this install has expired.

### Smaller fixes
- **Fixed:** the licence card no longer says "paid editing stops in 0 days" on the last day of grace.
- **Fixed:** a link straight to Insights or Busy Times opens it, not the plain replay.
- **Fixed:** removing PadSpan HA or PadSpan Bright while the other is still installed no longer changes WLED lights the other one is running, and still gives back the rest.
- **Fixed:** alerts sent to another integration's message service (for example Telegram) work again.
- **Fixed:** "forget this object" and removing a beacon now clear what PadSpan remembered about it. Neither had ever worked.

---

## 0.38.118 — Saying plainly what the licence check sends (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Privacy
- **Changed:** the README and the Update Check card used to say that turning Update Check off stops all contact. That isn't quite true: if you've entered a licence key, PadSpan still checks it with traks.ca once a day, sending the key and Home Assistant's instance ID, so a refunded key stops working. Both now say so. With no key entered there is no licence check.

---

## 0.38.117 — Phones keep one set of entities, and Insights without a floor plan (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Home Assistant entities
- **Fixed:** a phone set up with the phone wizard (its iBeacon and its IRK share one name) no longer shows not_home on its Area sensor while its tracker follows it. A restart also no longer makes a second set of entities (`device_tracker.phone_2`) and leaves the one linked to your Person unavailable. Entities you already have keep their names.
- **Changed:** setup no longer asks for an update interval. It never did anything; how often PadSpan updates is set in the PadSpan panel.

### Traceback and Insights
- **Fixed:** Insights and Busy Times now work on a house that has rooms but no floor-plan photo.
- **Fixed:** a custom Traceback range entered backwards (start after end) now loads instead of showing "No data in range".

### Tags
- **Fixed:** NFC tap-to-identify names the object after the tag's name in Home Assistant, instead of "NFC: " and the tag's id.

---

## 0.38.116 — Traceback stops eating memory, licences behave, and a round of smaller fixes (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Memory and history
- **Fixed:** Traceback no longer holds its week of history in memory. Since 0.38.112 it records around the clock, and after a restart a full week could take about 600 MB with ten devices at home. It now reads the history from disk when you play it back.
- **Fixed:** Insights and Busy Times no longer stall Home Assistant while they load.
- **Changed:** a backup now includes the last day of Traceback instead of the whole week, which was around 120 MB per backup. Restoring a backup adds its Traceback to what you have instead of erasing everything recorded since.
- **Fixed:** Forensics and Traceback are saved when Home Assistant stops. Each restart lost up to 5 minutes of Forensics.

### Licences
- **Fixed:** restoring an older backup keeps the licence key you have now. Restoring one from before you bought could lock paid editing.
- **Fixed:** the grace period after a licence expires is the full 14 days, and the licence card now says it has expired and how many days are left, instead of "Trial active" with a negative count.
- **Fixed:** a factory reset keeps a PadSpan Bright Pro key as Bright Pro.

### Presence and devices
- **Fixed:** ESPresense scanners and readings no longer drop out at random on busy houses.
- **Fixed:** a phone resolves straight away after you add its IRK, instead of up to 20 minutes later.
- **Fixed:** a Bluetooth proxy that has disconnected no longer shows as scanning.
- **Fixed:** the `padspan_room_change` event no longer misses a room change that comes within 30 seconds of the last one.
- **Fixed:** MQTT now reports a device as away on the same timeout as the HA sensors, publishes `not_home` for its area when away, and sends distance.
- **Fixed:** PadSpan devices can now be deleted from Home Assistant's device page.
- **Fixed:** `padspan_ha.dump_devices` with `notify: false` no longer creates a notification.
- **Fixed:** an automation that turns a scene off is refused. Home Assistant can't turn scenes off, so it never did anything.

### Traceback, Forensics, Lost & Found
- **Fixed:** Distance Traveled counts movement within a room, not only jumps between rooms.
- **Fixed:** Forensics keeps every visit inside the retention you chose. A device that comes and goes often lost its older visits after 50. The "+N more" count and the CSV export now include every session.
- **Fixed:** a Forensics search no longer fails now and then with "Search failed".
- **Fixed:** Lost & Found's "last seen" stays current on a screen left open.

---

## 0.38.115 — A cleaner opt-in report view (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Developer view
- **Changed:** Install Base, the developer's view of what the opt-in reports add up to, is laid out as a numbered report with readable bar charts, percentages next to counts and a table view for every chart. It now asks for a PIN first. It is only on the developer's menu; nothing changes for anyone else.

---

## 0.38.114 — Calibration tools that do what they say, walls that keep their doors, and WLED that can always go back (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Calibration
- **Fixed:** Settings → per-map **Clear (N)** now deletes those points. It deleted nothing and said "Cleared 0", and the points stopped showing on the map while still steering positioning.
- **Fixed:** importing the same calibration file twice no longer saves every point again. Imported points keep the date they were collected, and Import shows up on an install with no points yet, which is when you need it.
- **Fixed:** Beacon Tune's "replace old data" step saves the new reading first. If that save failed, the beacon's old data was already deleted.
- **Fixed:** Replace Scanner and Relearn Radio take effect right away when you use the Random Forest. Before, they waited for the next point or a restart. Replace also no longer gives a point two readings from the same scanner.
- **Fixed:** restoring maps from a backup no longer adds a junk one-scanner calibration point for every live beacon. Pinned-beacon auto points no longer pick up a device name as their room.

### Maps and rooms
- **Fixed:** dragging a wall in the Rooms editor keeps its linked door or window sensor, opener, lock and Invert.
- **Fixed:** Add room and Delete room keep your other unsaved Rooms-editor changes.
- **Fixed:** cropping, rotating or replacing a floor plan no longer pulls other floors' scanners and beacons onto it.
- **Fixed:** a floor Home Assistant removes keeps its heights while PadSpan still has rooms on it.
- **Fixed:** a newly placed light keeps the normal marker size and wall inset. It used to shrink to half size when you pressed Save. Lights you have already placed keep their current size.

### WLED
- **Fixed:** deleting PadSpan now gives every WLED light it runs its own sync settings back. Before, those lights kept sync switched off for good.
- **Fixed:** restoring an older backup no longer forgets which lights PadSpan runs or their original sync settings.
- **Fixed:** without a licence, one offline light no longer stops the rest of its team switching.
- **Fixed:** if the licence lapses, a team PadSpan runs can be given back to WLED sync from the light's card.

---

## 0.38.113 — Phones keep their alerts, restores stick, and settings that did nothing say so (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Follow alerts and presence
- **Fixed:** alerts for a phone known by its IRK keep working after the phone changes its Bluetooth address, which phones do every 15 minutes or so. They used to stop after the first change.
- **Fixed:** a tagged device coming home is no longer reported, alerted or tracked in the room it left from. It starts fresh from where it is heard.

### Backups and factory reset
- **Fixed:** restoring a backup now really restores Forensics, PadSpan's device list and the object history. Before, each was written back to its old state within seconds.
- **Fixed:** a restored Traceback now survives a restart.
- **Fixed:** factory reset now erases Traceback history completely, plus PadSpan's device list (so tags and labels don't come back), Lost & Found and Forensics, as its screen promises.

### Settings
- **Changed:** **Auto-Offset** never did anything: only the manual offset you save is applied, and the old advice to set manual to 0 left those scanners uncorrected. The Off/Partial/Full buttons are gone and each scanner shows a **suggested** offset you can type in.
- **Changed:** in Manage → Beacon Signal Profiles, the per-beacon **Tune** switch never did anything and is gone. The other switch only shows or hides the report, and it now says so.
- **Fixed:** Suspend All Databases and Resume now say when they didn't work (just after a restart) instead of reporting success.

---

## 0.38.112 — Traceback records all day, and quieter, steadier alerts (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Traceback
- **Fixed:** Traceback now records whether or not a PadSpan page is open. It only recorded while someone had PadSpan on screen, so overnight and working hours were usually empty.

### Follow alerts and Home Assistant events
- **Fixed:** room-change alerts are limited to one a minute per device again. A tag sitting on the edge of two rooms could send an alert every few seconds.
- **Fixed:** restarting Home Assistant no longer sends "moved from unknown to …" for every followed device, or a `padspan_room_change` event from nowhere.
- **Fixed:** the `padspan_room_change` event now fires for followed Bluetooth devices and phones. Before, only followed iBeacons fired it.

### Phones (Companion App)
- **Fixed:** **Unfollow** in Overview's Track Your Phone works. It always showed Error.
- **Fixed:** unfollowing a phone now removes its label everywhere, including the label on its IRK identity. Before, the phone stayed tagged and kept its Home Assistant entities.

### Calibration and mapping
- **Fixed:** a scanner set to a whole-metre height or position (like exactly 2 m) can be moved and saved again. Saving it failed every time.

---

## 0.38.111 — Backups keep Lost & Found, and a setting that did nothing is gone (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Backups
- **Fixed:** a PadSpan backup now includes Lost & Found, each tagged device's last confirmed room. Restoring a backup used to reset all of them to unknown.

### Settings → Presence
- **Removed:** the **Linger time** card. It hasn't done anything since 0.20.16: a device keeps its room for two minutes after its last signal, whatever the card said.

### Help improve PadSpan (opt-in usage report)
Only while the report is on, and counts only.
- **Added:** how often tagged devices arrive and leave, how many Follow alerts were sent or failed, whether the phone setup's BLE Transmitter command reached the phone, failed MQTT publishes, and how many devices one update merged by their Home Assistant device. These say whether this week's fixes hold in real homes.

### For developers
- **Added:** `docs/BUG_LOG.md`, a running record of each bug fixed: what people saw, why, the fix and release, and how the opt-in report shows it.

---

## 0.38.110 — Arrive and leave alerts actually fire (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **If you set up arrive or leave alerts,** expect them to start working. Restarting Home Assistant no longer sends an "arrived" alert for every device.

### Follow alerts and automations
- **Fixed:** a tagged device now "leaves" when it hasn't been heard for the away timeout, and "arrives" when it's heard again. Before, PadSpan treated a tagged device as present whenever it was in its device list, and tagged devices never leave that list. So "arrived" fired only the first time a device was ever seen, and "left" never fired. That broke three things: Follow's arrive and leave alerts, the `padspan_device_arrived` and `padspan_device_departed` events for your Home Assistant automations, and PadSpan's own arrive/leave rules. They now use the same away timeout as the device trackers.
- **Fixed:** restarting Home Assistant no longer counts every device as having just arrived, which sent every arrive alert at each restart.
- **Fixed:** a room-change alert sent to a phone you picked, with no email address, now goes out. Before, room-change alerts needed an email even though arrive and leave alerts didn't.
- **Changed:** in Follow, **Send Test** works with just a phone picked, and an alert counts as **Active** with either an email or a picked phone. Manage's list of saved alerts now shows phone-only alerts too, so you can see and delete them.

---

## 0.38.109 — The phone wizard reaches your phone, and MQTT keeps publishing (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **MQTT users:** topics for labels without `#`, `+` or `/` are unchanged. A label with one of those now publishes under a topic with `_` in its place; it didn't publish before.

### Phone setup (Companion App)
- **Fixed:** turning on a phone's BLE Transmitter from the wizard now works. PadSpan sent the command to a notify service named after the phone's internal ID, which doesn't exist; the Companion App names it after the phone. If it can't find the phone's service, the wizard now says to turn the transmitter on in the app.
- **Fixed:** a phone whose name has an apostrophe or hyphen (like "Garry's Pixel 8") is listed once, not twice with the second one saying its sensor isn't registered.

### Devices
- **Fixed:** an iBeacon and a plain Bluetooth address that belong to the same Home Assistant device are one device in PadSpan. The match by Home Assistant device never worked; only devices whose addresses happened to overlap were combined.

### MQTT publishing
- **Fixed:** a device label with `#` or `+` stopped MQTT publishing for every device after it, on every update. Each device now publishes on its own, and those characters (and `/`) become `_` in the topic.

---

## 0.38.108 — Alerts reach your phone, and Bermuda houses build faster (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.

### Follow alerts
- **Fixed:** an alert sent to a phone you picked from the list now reaches the phone. Phones are older-style notify services, and PadSpan sent them the newer kind of call meant for notify entities. Home Assistant drops that call without an error, so the alert counted as sent and went nowhere, and **Test** said it worked. If you picked your phone and got no alerts, that was why.
- **Fixed:** opening the service list no longer writes a warning to Home Assistant's log every time.

### With Bermuda installed
- **Fixed:** each update walked every Bluetooth device in Home Assistant once for every Bermuda device it lists, looking for a match that could never be found. With thousands of each, that alone cost a large share of each update; 3,000 of them now take a tenth of the time.
- **Fixed:** a saved tag that no longer exists cost a walk over every Home Assistant state on every update, once per tag. All of them now share one.

### Help improve PadSpan (opt-in usage report)
Only while the report is on, and counts and timings only.
- **Added:** how long each part of an update takes (the Bluetooth fetch, the pass over Home Assistant, the device list, the finishing touches), how many Home Assistant states there are, how many entities and devices Bermuda has, and how many saved tags can't be found. A third of the installs reporting take 1.4 to 18 seconds per update, every one with Bermuda, and this says which part.

---

## 0.38.107 — Beacon Tune saves for real, and zooms (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **Beacon Tune users:** since 0.30.0, a beacon placed or moved in Beacon Tune was never saved, though it said it was. Place or move it again after updating and it will be. Beacons placed in Mapping's editor were saved and are fine.

### Calibration → Beacon Tune
- **Fixed (issue #89):** placing, dragging or relocating a beacon now saves its position, in metres, the same way Mapping does. That is what makes PadSpan treat it as fixed: its room holds, and its drift from the live estimate is tracked. Only beacons you placed or moved are saved. Your labelled devices that Beacon Tune shows at their room's centre are never saved as fixed beacons, and a beacon you didn't touch is never rewritten. A map that isn't placed in metres yet can't be saved to, and Beacon Tune says so instead of pretending.
- **Added (issue #90):** zoom and pan on Beacon Tune's map, like Pin & Listen: scroll to zoom, drag the map to pan, pinch on a touch screen. Dragging a beacon still moves the beacon, and double-click still places one. **⟲** or the 0 key resets the view.

### Overview
- **Fixed (issue #89):** a pinned beacon is drawn where it was pinned, not where the live estimate puts it.

### Calibration → Matrix
- **Fixed:** pinned beacons now appear as anchor rows. The live snapshot never carried their pinned position, so the rows never showed.

### Help improve PadSpan (opt-in usage report)
Only while the report is on, and counts only.
- **Added:** how many Beacon Tune saves reached the map, were refused because the map isn't placed in metres, or failed; how many records Lost & Found's one-time cleanup removed; and how often a Diag Export is built.

---

## 0.38.106 — A busy street costs less: CPU, memory, and a low-memory mode (2026-10-12)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **Lost & Found:** the first start after updating removes the records it kept for passing devices nobody tracks (see below). Labelled, followed and registered devices keep theirs.

### Performance (issue #91)
- **Fixed:** next to a busy street PadSpan worked out a room for every device in its list on every update, including thousands nobody has identified that hadn't been heard for hours. On the install that reported it, about 4,980 devices were held and about 210 were on the air. A device nobody has labelled, identified, pinned or followed, not heard for a minute, is now listed as it is and not worked on. Heard again, it is worked on again.
- **Fixed:** once more than about 1,000 devices were around, every device nobody has identified got a new internal ID on every update. Their IDs are now stable.
- **Fixed:** Lost & Found recorded every passing stranger's phone, kept it forever and saved the file again on every update. It now records only your own devices: labelled, identified, or a phone known by its IRK.
- **Fixed:** Monitor → Diag Export could freeze the browser on a busy street, because it turned the whole live snapshot into text every time the Monitor redrew. It's now built when you press **Build export**, with the device and advertisement lists cut to 200 each. All of your own devices are kept, and it says how many there were. The Debug tab is cut the same way.
- **Changed:** the object history keeps at most 10,000 devices nobody has identified. Past that, the ones heard longest ago go first. Your own devices don't count toward it and are never dropped.
- **Changed:** a Find My advertisement that hasn't changed isn't decoded again on every update, and the check for new Home Assistant entities looks only at labelled devices instead of sorting every device.

### Settings → Presence
- **Added:** **Low-memory mode**, for a Home Assistant machine with 2 GB of RAM. Off by default. When it's on, passing devices nobody has identified are kept for 15 minutes on the air and at most 2,000 of them, the device list keeps at most 2,000 of them for one day, and the Monitor's advertisement list shows at most 2,000. Your own devices, positioning, the Atlas and Live Aboard aren't changed by it. The card lists all of this and asks before it turns on. The details are on the Minimum requirements page (docs/MINIMUM_REQUIREMENTS.md).
- **Fixed:** **BLE Advertisement Timeout** said its default was 900 s and its range ran to 30 minutes. The default has always been 4 hours (14,400 s) and the range is 60 s to 4 hours; it now says so. Lowering it now lowers what the Bluetooth cache holds too. Before, the cache kept 4 hours whatever it was set to. The same goes for ESPresense.

### Help improve PadSpan (opt-in usage report)
Only while the report is on, and counts only. The full list is in the README.
- **Added:** how long each update's per-device step takes, how many devices it worked on and how many it skipped, how many Lost & Found records are held, and whether low-memory mode is on.

---

## 0.38.105 — Stable: device heights on the map, open doors on the Atlas, and Live Aboard's house (2026-10-06)

### Before you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **Heights move to the map:** heights set in Live Aboard before this version are copied to the map once. A backup is taken first.
- **Going back to an older version:** your map still saves, and the heights you set wait beside it until you update again. A height you change while on the older version isn't carried over; set it again in Mapping. A door you gave a type in Live Aboard can't be edited on the older version until you Reset it.

### Mapping (with Live Aboard on)
- **Added:** every placed device has a **Height** in the Atlas builder's inspector: Ceiling, High on the wall, Wall, Switch height, Table, Floor or a number. Each kind offers the heights that make sense for it (a leak sensor: Floor; a lock: Door height). Empty means the usual height for its kind.
- **Added:** a **Heights** list shows every placed device with its height. Sort it, set many at once, or show only the ones still using the usual height.
- **Changed:** dragging a device on the map keeps its height. Auto position says when it clears one.

### Atlas
- **Added:** an open door now looks open. Its leaf stands swung into the room from its hinge, and a faint arc shows its swing; the gap in the wall stays clear. A shut door still draws its grey line. Sliding, folding and garage doors show the way they stand open.

### Live Aboard — experimental (PadSpan Pro, off until you turn it on)
- **Added:** the house itself:
  - stairs between floors (straight, L or U), placed like furniture in Furnish;
  - doorways with no door;
  - doors shown open, ajar or shut;
  - a roof seen from outside, which lifts away as you zoom in;
  - a solid floor under each storey, so halls you never drew aren't holes.
- **Added:** door types: hinged, double, sliding, barn, pocket, bifold, overhead garage, roll-up, tilt-up and gate. Each moves its own way. PadSpan guesses the type until you pick one. A door follows its contact sensor, or its cover's position.
- **Safety:** a garage door or gate never moves from a tap in Live Aboard. A tap shows what it reads and when it last moved; press and hold for Home Assistant's own controls.
- **Added:** heights from Mapping. A device's height is set once and used by both views.
- **Added:** for a wall screen:
  - **Set as home** in Views ▾. The screen flies back to its home view after a minute untouched (Off, 30 s, 1 min or 5 min). It never does this while you're editing, furnishing or reading a card.
  - With no home set, it opens on the floor that shows the most rooms.
- **Added:** people:
  - Someone known only by room stands in that room, marked "room only".
  - **Carries** (admins) says which phone or tag is whose. One phone picked for two people stays with the first, and the screen says so.
  - **Follow** keeps a person in view.
  - The **People** chip flies to each person in turn.
  - Pinned tags stay where you pinned them.
- **Changed:** **Show people** and **Show tags & scanners** are now in Views ▾ too, and only an administrator can change them.

---

## 0.38.104 — Stable: rain and snow on the Atlas, fixes, and Live Aboard to try (2026-10-05)

This stable release brings everything since 0.38.85 (the 0.38.86 to 0.38.103 pre-releases) to everyone. The notes for each pre-release are below; this is the short version.

### Before and after you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **GPS Bridge users:** positions on Home Assistant's map were mirrored east to west and now plot the right way round. The bearing still means the compass direction of down-the-plan, so a plan drawn with north at the top is **180**. If you set your bearing by trial and error, check it again.

### Atlas
- **Added:** rain and snow fall around the house when it's wet or snowing: from a rain sensor, your weather entity or weather warnings. It's on by default; turn it off or change its strength in Settings → UI Structure → Atlas — Mapped Light Control → Outdoor weather.
- **Added:** zoom the sidebar's map in past the whole house and the bars step aside, so the map fills the screen. ☰, Escape or zooming back out brings them back. Rain and snow keep to the outside of the house while you do.
- **Added:** **⛶** takes the map full screen.
- **Added:** double-tap a room's floor to zoom to it.
- **Changed:** the emergency lighting button sits at the top right of the map, and can be hidden in Settings.
- **Changed:** one colour key for motion and air.
- **Fixed:** the rain-sensor and weather-warning lists only offer real rain sensors and warnings, never leak detectors.

### Mapping
- **Fixed:** in Basic mode, Library → **Open** now opens the plan (it switches to Advanced and says so).
- **Fixed:** the calibration wizard's quality report and the Atlas's "Build from relays" no longer bounce back to the first screen.

### Fixes everywhere
- **Fixed:** a wall switch flipped while PadSpan was putting a WLED light's look back is no longer undone.
- **Fixed:** a restore or factory reset can no longer land halfway through a save.
- **Fixed:** a manual backup that can't read one of its parts says so and saves nothing; it used to save that part empty.
- **Fixed:** release notes open inside PadSpan, closable on a wall screen.
- **Fixed:** phone layouts for the Atlas light list and the Mapping header.
- **Fixed:** trial and licence lines say each offer once, in plain words.

### Requirements and the opt-in usage report
- **Changed:** a machine with more than 2 GB of RAM is now the recommendation. Near a busy street PadSpan can hear thousands of passing devices, and a 2 GB Raspberry Pi has run out of memory within hours.
- **Added:** if you turn on the opt-in usage report, it now also covers:
  - PadSpan's memory use;
  - restarts and crashes;
  - how hard the Atlas works on each screen.
  It sends counts and buckets only. Off, nothing is measured.

### Live Aboard — experimental (PadSpan Pro, off until you turn it on)
- **Added:** Live Aboard is a house you can walk around, built from the map you already drew.
  - It has lights that look like your lights, motion you can see from across the room, and leak alarms and locks.
  - You can furnish it (with a starter set and a shared library), lay out LED strips and string lights where they really are, and show people, tags and scanners.
  - It follows the Atlas's look, and the Atlas's chips and buttons work on it.
- It's **experimental**: still changing, and some of a house may not show yet. Turn it on in Settings → UI Structure → Atlas — Mapped Light Control → 🏠 Live Aboard. Off, nothing of it loads.

---

## 0.38.103 — What a 2 GB Raspberry Pi needs (2026-10-05)

### Requirements
- **Changed:** a machine with more than 2 GB of RAM is now the recommendation. Near a busy street PadSpan hears thousands of passing devices, and on a 2 GB Raspberry Pi Home Assistant has been seen running out of memory within hours. A low-memory mode for 2 GB machines is being built; the new Minimum requirements page (docs/MINIMUM_REQUIREMENTS.md) has the details.

### Help improve PadSpan (opt-in usage report)
Only while the report is on (Settings → Presence → Help improve PadSpan), and counts and buckets only. The full list is in the README.
- **Added:** what PadSpan holds in memory: objects in the live snapshot, the object history and the Bluetooth cache (counts and estimated size), how many new devices arrive per hour, and how big the snapshot sent to open panels is.
- **Added:** how many times Home Assistant started since the last report, how many of those followed a crash (such as running out of memory), and the worst memory seen. It is kept on disk, so a run that ran out of memory still reports, and it is deleted when you turn the report off.
- **Added:** how hard Home Assistant works while the Atlas or Live Aboard is on a screen, and how smoothly each screen draws them: frame rate and browser memory in buckets, plus the class of device (memory, CPU threads, WebGL 2, touch).

## 0.38.102 — Motion you can see from across the room (2026-10-05)

### Live Aboard
- **Added:** motion in Live Aboard, in the Atlas's own colours.
  - A new trigger sends one ring across the room's floor, and the room's floor glows blue.
  - After the 5-minute hold, the glow steps through the Atlas's colours by age: cyan, green, yellow, orange, red, then magenta at 2 hours. Each step is fainter than the last, and the glow is gone at 6 hours.
  - "Now" reads at a glance from the whole-house view, day or night, in every look.
- **Added:** an occupancy or presence sensor (mmWave) that is on holds its room steady. A motion + occupancy pair (an ecobee room sensor, say) reads its motion half only, as the Atlas does.
- **Added:** each sensor is a small model on its wall at its height: a PIR dome, a presence puck, or a room sensor's square face. Above it is a marker in its motion colour; tap the marker for the week's activity, hover it for "Motion · Kitchen · 3 min ago".
- **Added:** coverage. A sensor's detection fan flashes when it triggers and shows when you hover it. Pick **Motion** on the ☰ chips to see every sensor's coverage.
- **Added:** a sensor with no reading gets a dashed ring and no glow. One stuck on is drawn striped, with a ⚠ on its marker.
- **Added:** a **Motion:** chip by the top hint ("Living Room now · Hall 4 min"). Tap a room in it to fly there; ⓘ shows the colour key.
- **Fixed:** a motion sensor outside every room no longer draws its patch floating in empty space beside the house.

---

## 0.38.101 — The Atlas and Live Aboard, one program (2026-10-05)

### Live Aboard looks like the Atlas
- **Changed:** Live Aboard now follows the Atlas's look. With Showcase on, it uses your Showcase theme's page and colours; with Showcase off, it uses the plain Atlas's dark green.
- **Changed:** rooms are drawn the Atlas's way: an outline in the room's colour, a faint fill, and the name in the room's colour (UPPERCASE and spaced where the theme says).
- **Changed:** each floor carries the Atlas's numbered badge in its floor colour, and readings use the Atlas's words and colours.
- **Changed:** Settings → UI Structure → Atlas → 🏠 Live Aboard → **Look: Same as the Atlas / Live Aboard's own**. Pick "Live Aboard's own" for the look it had before.
- **Fixed:** with the map alone or full screen, the 🌴 Vacation banner and the emergency lighting dial stay on top, and ☰ (bring the bars back) sits under the dial, never beneath it.

### Every Atlas control and device works in Live Aboard
- **Added:** the Atlas's device-type chips (☰: Lights, Strips, Fans, Motion, Temps, Humidity, Air, Doors/Windows, Emergency) fade every other type in Live Aboard too, including fixtures, fan blades and linked furniture, and those stop taking taps.
- **Added:** **◎ Find active** flies Live Aboard to the tripped sensor or lit light, switching floor if needed.
- **Added:** ⚙ **Zoom − 100% +** zoom Live Aboard while it shows; 100% is the whole house.
- **Changed:** in Mapping, **Save view** saves Live Aboard's view and **Reset view** shows the whole house, while Live Aboard is on screen. Spacing and L / R step aside, because they only shape the flat map.
- **Added:** leak sensors show in Live Aboard. Dry, they are a quiet puck on the floor. Wet, or within two days of an alarm, they show the Atlas's alarm: rippling rings across the room and a red WET / ALARM tag.
- **Added:** locks show on their wall, coloured by state; tap and hold work as on the Atlas.
- **Added:** device codes (A01, M08…) show in Live Aboard at room scale, unless "Hide device codes" is on.

### The flat Atlas gets what Live Aboard has
- **Added:** zoom the sidebar's flat map past its whole house and the bars step aside, so the map fills the panel. ☰, Escape or zooming back out brings them back.
- **Added:** **⛶** takes the flat map full screen. Cards, sheets and toasts opened from it stay in sight there, and in Live Aboard's full screen too.
- **Added:** double-tap a room's floor on the flat map to zoom to it. A double-tap on a light switches it once.
- **Changed:** **Show people** and **Show tags & scanners** now work on the flat Atlas too, with or without Live Aboard. The flat map shows:
  - each tag named, with a ring as wide as its position is unsure;
  - scanners as small squares;
  - people as a round marker with their initial.
  Tap one for the same card Live Aboard shows. One read of the live data serves both.
- **Added:** a light's "What is this?" kind from Live Aboard is drawn in the matching Atlas shape, unless you set the shape on the Atlas yourself. **Show furniture** (⚙, off until you turn it on) draws your Live Aboard furniture, doors and windows faintly on the flat map.

---

## 0.38.100 — Lay out strips and string lights where they really are (2026-10-05)

### Live Aboard
- **Added:** **Strip** in Live Aboard's Edit (in Mapping) puts LED strips and string lights where they really are:
  - Pick a light, tap one or choose it from "Lights to lay out", then press on a wall and drag along it. The run carries round corners onto the next wall. You can also tap its points one at a time.
  - One tap does a whole run: **Round this room** (with gaps at the doors), **Under**, **Behind** or along the **Top edge** of a piece of furniture, **Along a rail** of a deck, or **Continue from** where another light's run ends (each WLED segment is its own light, so each shows its own colour).
  - Set the height with chips (toe-kick, counter, under the cabinets, valance, cove, ceiling edge), type it in cm, or drag the handles: the middle moves the whole run, an end tilts it for stairs or a rail.
  - Choose which way it shines: up the wall, down onto the counter, into the room, or onto the wall behind a TV or a bed.
  - **String lights** are a new kind: bulbs on a wire that hangs in swags between its points, with the spacing and the sag you set.
  - A run on a piece of furniture moves with it.
  - Only Live Aboard's own file changes; the map is never touched.
- **Added:** floors work like the Atlas's floor chips.
  - The floor stepper shows each floor's lights on and its motion.
  - **Views ▾** (or **View ▾** on a phone) lists every floor to jump to.
  - Each floor keeps its own camera while you move between floors.
  - With the map alone (zoomed in), PgUp and PgDn change floors and Home shows them all; the floor's name shows in the corner for 2 seconds, and a tap on it lists the floors.
- **Changed:** in Mapping, Show people and Show tags & scanners now move live, as on the sidebar.
- **Changed:** deleting a person in Home Assistant deletes their Live Aboard figure; renaming them keeps it.
- **Fixed:** the door and window tool draws on the floor you picked, not only the top one showing.

### WLED
- **Fixed:** a wall switch flipped while PadSpan was putting a WLED light's look back is no longer undone.
- **Fixed:** on a one-segment strip, the brightness Home Assistant reports after that is no longer taken for someone else's change.

### Backups
- **Fixed:** a restore or a factory reset can no longer land halfway through a Live Aboard save.
- **Fixed:** a manual backup that can't read one of its parts now says so and saves nothing. It used to save that part empty.

### GPS Bridge
- **Fixed:** positions on Home Assistant's map were mirrored east to west; they now plot the right way round. The bearing still means the compass direction of down-the-plan, so a plan drawn with north at the top is 180. If you set the bearing by trial and error, check it again.

---

## 0.38.99 — Live Aboard: real-looking lights, the map alone, and your tags (2026-10-05)

### Live Aboard
- **Changed:** lights look like the lights you have. A strip, valance, cove, under-cabinet or TV backlight is one continuous line that washes its wall, counter or floor — no more rows of glowing dots where there is no string light. Pots named round a room are separate pots with their own pools of light, a deck gets small pots along its edge, and a WLED lamp, panel or ring looks like one. A light PadSpan isn't sure of is a small point with its pool, never an invented fixture. Lights that are off are shaded like the room and fade at night; ceiling fans turn while they run.
- **Added:** in Mapping, Live Aboard's **Edit → Heights**: tap a light, then **What is this?** tells Live Aboard what a light is (pot, strip, lamp, fan…). It changes only Live Aboard; the map and the Atlas stay as they are.
- **Added:** zoom in past the whole house on the Atlas and every bar and sidebar steps aside, so the house fills the panel. Zoom back out, press ☰ or Escape to bring them back. The **⛶** button takes it full screen.
- **Changed:** a floor stepper (up, the floor's name, down, All) replaces the floating floor badges, and **Views** keeps the whole house plus views you save on this browser. Double-tap a room to fly in to it. Room names stand upright at a size you can read, each room gets one chip of readings, and the night view keeps floors, outlines and walls readable. A phone gets one compact row.
- **Added:** **Show tags & scanners** (Settings → 🏠 Live Aboard, off until you turn it on): every tag the Atlas shows appears where it is, named, with a faint ring that widens the less sure its spot is, and every scanner stands at its stored height. Tap a tag for its room, when it was last seen and which scanners hear it. **Show people** now shows the people alone.
- **Added:** placing exactly in Mapping → Furnish: type X, Y, Height and Angle; arrow keys move a piece 1 cm (Shift 10 cm) and [ ] turn it 15° (Shift 1°); while it moves, two short lines show how far the nearest walls are. **Stand on what's under it** puts a lamp onto its table; **Hang on wall** puts a TV flat on the nearest wall at the height you choose.

### Atlas
- **Fixed:** a new hold-and-slide dim on the flat Atlas answers at once, as it does in Live Aboard.

### Under the hood
- **Fixed:** the shared furniture library no longer depends on a package Home Assistant may not have; this also turned the test runs green again (PadSpan Bright 0.38.98 was held back by it).

---

## 0.38.98 — Share your furniture (2026-10-04)

### Live Aboard
- **Added:** the shared furniture library is open. Turn on Settings → UI Structure → Atlas — Mapped Light Control → 🏠 Live Aboard → **Shared library** (administrators), then share a piece from its panel in Mapping → Furnish (**Share…**): you accept the library's terms once, fill in its details sheet, and other PadSpan houses can find it, filter it and place it. Only the piece's shape, sizes, colours and details sheet are shared — never a photo, your floor plan, where it sits, its name in your house, a linked device or anything about you. **Withdraw my shared furniture** in the same settings takes yours out again. With the switch off, Library shows the starter pieces and nothing leaves your house.
- **Fixed:** undoing a PadSpan Bright import (restoring the backup it took first) now also takes away a Live Aboard file the import created on a house that had none.

---

## 0.38.97 — A starter set of furniture (2026-10-04)

### Live Aboard
- **Added:** Mapping → Furnish → **Build ▾** now opens with a **Starter set** of ready-made pieces: a three-seat sofa with rolled arms and a queen bed with a slatted headboard and a footboard (the two pieces from the Live Aboard preview), then a coffee table, TV and media unit, floor lamp, rug, dining table and chair, bedside table, table lamp, dresser, wardrobe, desk, office chair and a plant. Pick one and place it like any other piece; every slider still works on it.

---

## 0.38.96 — Live Aboard: walk around your house, and furnish it (2026-10-04)

### Live Aboard (new, PadSpan Pro and Bright Pro, off until you turn it on)
- **Added:** Live Aboard, a house you can walk around, built from the map you already drew: your floors stacked at their real heights, walls that cut away so you can see in, every light glowing in its real colour, doors and windows that open and close with their sensors, and the sun and shadows of the real sky. Turn it on in Settings → UI Structure → Atlas — Mapped Light Control → **🏠 Live Aboard** → "Show Live Aboard on the Atlas". Then the Atlas has a **🏠** button in its rail (and "Map / Live Aboard" beside the zoom) that switches between the flat map and Live Aboard. Each screen remembers which you picked.
- **Added:** taps and holds work as on the Atlas: tap a light to switch it, hold for its controls, hold and slide to dim. A spinnable compass (top left) lines north up with what you see.
- **Added:** **Mapping → Furnish**: build furniture with a few sliders (sofa, bed, table, chair, desk, dresser, TV and media unit, lamp, rug, shelf, wardrobe, plant, and device pieces like a washer, dryer, robot or mower dock, car, charger, radiator, fan and speaker). Drag a piece across its floor (it snaps flat to walls), turn it in 15° steps, move it to the floor above or below (**Floor ▲ / ▼**), and raise it in the room (**Height in room**) to stand a lamp on a table or hang a TV on a wall. Fit warnings say when a piece is in a wall, in a door's swing or in front of a window; they never stop you. Nothing is stored until Save, with Undo, Redo and Discard.
- **Added:** "This is a device…" links a piece to a Home Assistant device: a lamp glows with its light, a TV lights up while it plays, a fan turns, a washer shakes while it runs, a robot vacuum or mower leaves its dock while it works, a heater glows while it heats, a car glows while it charges. Tapping a linked piece does what tapping that device on the Atlas does.
- **Added:** **From a photo**: take a photo of a piece of furniture and your own Home Assistant AI Task (2025.8 or newer, with a model that can read images) fills in the sliders. You type one real measurement. The photo goes from your browser to Home Assistant to the AI Task you chose, and is then thrown away. PadSpan never keeps it. A cloud AI Task means the photo leaves your house; the screen says which one will read it.
- **Added:** **People & devices**: give each person in Home Assistant a simple figure (by hand, or from a photo with their agreement; never a likeness), and give tags and scanners a look. With Show people on, figures walk to where their phone or tag is. Figures stay in your house: they are never shared or sent anywhere.
- **Added:** **Library**: a starter set of furniture to browse, filter and place. (Sharing your own pieces with other PadSpan users comes later.)
- **Added:** **Import** a Sweet Home 3D file's doors, windows and furniture (as kind and size, drawn by PadSpan's own pieces). You pick what comes in; nothing is written until Save.
- **Added:** rain and snow fall around the house in Live Aboard, from the same Outdoor weather settings as the Atlas; a snowfall warning settles snow on decks and roofs. "Use the Atlas's Showcase look" lights Live Aboard in your Showcase theme's colours.
- Everything Live Aboard keeps is in its own file. It never changes your map, rooms, walls or light positions. Settings → 🏠 Live Aboard → **Remove all furniture** takes a backup first. A screen too slow for it shows the flat Atlas with a note; at rest Live Aboard draws nothing.

---

## 0.38.95 — Open a floor plan from Basic mode (2026-10-04)

### Mapping
- **Fixed:** in Basic mode, Mapping → Library → **Open** did nothing at all, with no sign why (editing a floor plan is in Advanced mode, and Basic quietly sent you back to the Library). Open now switches to Advanced, says so, and opens the plan. The Basic / Advanced button at the top switches back. Thanks, Jay.
- **Fixed:** in Advanced mode, the calibration wizard's "See detailed quality report" and the Atlas's "Build from relays" opened their screen and then bounced you back to the first menu screen a moment later. They now stay open.

---

## 0.38.94 — Rain and snow you can see from across the room (2026-10-04)

### Atlas — outdoor weather
- **Changed:** light rain was so faint that from across the room, on a wall panel, the Atlas looked dry while it rained. Light rain now has more streaks, longer and brighter, so it reads at a glance. It is still a calm drizzle, and heavy rain is still clearly heavier. Light snow has slightly bigger, brighter flakes for the same reason.
- If it's now too strong for your screen, turn it down with Settings → UI Structure → Atlas — Mapped Light Control → Outdoor weather → **Strength**.
- **Fixed:** the **Weather warnings** list offered water-leak detectors whose name says "warning" (say, an "Emergency Flood Warning"). A leak detector never says anything about rain or snow, so picking one meant warnings could never make the rain heavy. They're no longer offered. If you picked one, choose Automatic or a real weather-warning sensor.

---

## 0.38.93 — One colour key for motion and air on the Atlas (2026-09-29)

### Atlas
- **Changed:** the colour key under the Atlas is one strip for motion and air quality, labelled "Motion · Air". Both use the same colours in the same order, from blue (motion just now, good air) to magenta (motion long ago, hazardous air), so they were two identical-looking strips side by side.
- **Changed:** the key's label is smaller than the floor names, so it no longer reads as another floor.

---

## 0.38.92 — Only real rain sensors in the rain-sensor list (2026-09-29)

### Atlas — outdoor weather
- **Fixed:** Settings → Outdoor weather → **Rain sensor** listed every entity of a rain device (its cleaning reminder, light level, last seen), water-leak detectors, and anything else with "rain" in its name. It now lists only actual rain sensors: an on/off sensor named for rain (by its own name, not its device's), a rain rate, or a rain gauge's latest reading.
- **Fixed:** a solar rain sensor's "Rain intensity" is no longer offered. It's a voltage that reads above 0 even when dry, so picking it would have drawn rain all the time.

---

## 0.38.91 — Rain and snow on the Atlas (2026-09-29)

### Atlas — outdoor weather
- **Added:** when it's raining or snowing, faint rain or snow falls everywhere around the house on the Atlas, never over a room or a floor. It's in the Atlas sidebar and Mapping → Atlas. PadSpan Pro and Bright Pro animate it; the free map shows the same weather still, with no motion. Reduced motion on the phone or tablet shows it still too.
- **Added:** light rain whenever it's wet: the rain sensor if you chose one, otherwise the weather entity (rainy, pouring, snowy, snowy-rainy, hail, lightning-rainy). A rain sensor alone only ever shows light rain. Heavy rain needs a rainfall warning or the weather entity saying *pouring*. Snow when the weather entity says snowy or snowy-rainy, or at 1 °C (34 °F) or colder; heavy snow, with a pale rim building up around the floors, only on a snowfall warning.
- **Added:** weather warnings are found by themselves from Environment Canada, MeteoAlarm, DWD, NINA, Météo-France, and the weatheralerts and nws_alerts custom integrations (the USA's own weather service has none). Without any, *pouring* is the only heavy-rain signal. No weather entity and no rain sensor: no weather.
- **Added:** Settings → UI Structure (Advanced mode) → Atlas — Mapped Light Control → **Outdoor weather**: on/off (on by default, both editions; off draws nothing at all), rain sensor (the list offers sensors that say it's raining now, like a rain rate, a rain gauge's latest reading or a rain switch, not running totals like daily rain or a chance of rain), weather entity, warnings sensor, and **Strength** (0.5× to 1.5×). Each saves as soon as you change it.
- **Added:** if the report is on, the opt-in usage report counts what the weather did, once per page: whether it failed and drew nothing (and why), whether it showed light or heavy rain or snow, or still, and what decided it (rain sensor, weather entity, which warning service). Words only, never an entity or a warning's text.
- Two choices made for now, easy to change: a rain-rate sensor never scales the rain up (any reading above 0 is light rain), and rain falls on outdoor areas (a garden or yard floor with its own plate), never on the house's floors.

### Opt-in usage report — how hard the machine works
- **Added:** if the report is on, it says what kind of machine PadSpan runs on: CPU count, RAM (the size it's sold as), architecture, installation type and board family (a Raspberry Pi 4, a virtual machine, …). Each is a word from a fixed list, never a model name, host name or serial.
- **Added:** and how hard that machine works, measured once a minute: load per CPU, Home Assistant's own CPU and memory, memory available, swap, how late Home Assistant's event loop runs, and how long PadSpan's live snapshot and presence poll take. Each is sent as median, 95th percentile and maximum, with how many times a limit was hit (load above 1 per CPU, Home Assistant above 90% of one core, under 10% memory free, a second's lag). Nothing is measured in the first five minutes after Home Assistant starts, so a restart doesn't count as a max-out.
- This is to see, per kind of machine, whether a feature is too heavy for a Raspberry Pi before it reaches everyone. Measuring costs one timer a minute; its file reads run off Home Assistant's event loop.

---

## 0.38.90 — Release notes you can close on a wall screen, and phone layouts (2026-09-28)

### Release notes
- **Fixed:** **See what changed** on the "PadSpan HA updated" note opened the website in a new tab, which a wall touch screen (full-screen browser, no tab bar, no keyboard) could not close. The notes now open inside PadSpan, with a large ✕, a **Close** button and a tap outside to close. They come with PadSpan, so they work without the internet.
- **Fixed:** on a wall screen, the note's other links (the Pro line, **Or buy**) name the website instead of opening a tab you couldn't close.

### Phones
- **Fixed:** the Atlas light list no longer breaks words one letter per line; on a phone it hides the columns that don't fit. The desktop Mapping editor keeps them.
- **Fixed:** the Mapping header's **Refresh** button keeps its width on a phone.
- **Fixed:** padspan.traks.ca is never wider than a phone screen, so links to a section land on it.

### Trial and licence
- **Changed:** where nobody hit a paid feature (the update note, the one-time card, the menu line), **Or buy** is a small grey link under the trial button.
- **Added:** Settings → PadSpan licence mentions the $89 lifetime offer until October 31.
- **Fixed:** the menu's **💡 Lighting · free trial** line is easier to read.

---

## 0.38.89 — Design pass: the trial asks once, the emergency button stays usable (2026-09-28)

### Trying the lighting map
- **Changed:** the "New: try the lighting map free for 90 days" line is in one "PadSpan HA updated" note only — the update that brought the trial. Later notes go back to the short line about what a licence adds. It never shows on a wall kiosk (`?kiosk=1`), or once the one-time card about the lighting half has been shown.
- **Changed:** the one-time "PadSpan's working in your house" card waits for your next visit if another card (the update note, the usage report question, Getting started) was on Overview this time, so two offers never show one after the other.
- **Changed:** the **💡 Lighting · free trial** line in PadSpan's menu shows to administrators only (the only people who can start the trial), and goes away once the one-time card about the lighting half has been shown.
- **Fixed:** closing the card with ✕ after starting a trial from it no longer counts as saying no.
- **Fixed:** restoring a backup, a factory reset, or importing a PadSpan Bright house keeps your answer to the trial card and when PadSpan first ran here, so the card doesn't come back.
- **Changed:** on Locate and Busy Times the trial card now says plainly that the trial doesn't unlock them, instead of repeating that they need Pro.
- PadSpan Bright: the trial card no longer mentions presence tracking you can't see.

### Atlas — Test emergency lighting
- **Fixed:** with the button switched off in Settings, a test started from another screen still shows the button, so it can be seen and ended. The Atlas still checks every 5 minutes while it is off.
- **Fixed:** on a phone the button is full size again; the smaller one was hard to hit.
- **Fixed:** an open menu from the Atlas's left rail no longer covers the button.
- **Fixed:** in the list of emergency lights, the On/Off states and buttons now line up.
- **Fixed:** the longer messages (for example after a real emergency during a test) stay up long enough to read, and a new message replaces the old one instead of landing on it.

### Settings
- **Changed:** the Mapped Light Control card is now **Atlas — Mapped Light Control** (Settings → UI Structure, Advanced mode). It says the Atlas is on by default. **Show the Test emergency lighting button on the Atlas** saves as soon as you tick it, with no restart; only the sidebar switch needs **Save** and a Home Assistant restart.
- **Fixed:** "Become a tester" reads properly: "Scanners: 19", not "19 — 19 other", and "2 Apple devices, 3 Find My accessories".

### Phone
- **Fixed:** a red "🚨 0" alarm pill showed in PadSpan's top bar on every phone even with no water alarm latched.

### Website
- **Fixed:** "Upgrade to PadSpan Pro — $12" and "Buy PadSpan Bright Pro" were grey boxes (the first unreadable); they now look like the buttons beside them.
- **Fixed:** "What Pro unlocks today" had two markers on every line.
- **Fixed:** a Buy link from the app landed a screen below the Pro section while the page's pictures loaded.

### Settings and backups
- **Fixed:** ticking or unticking the emergency button's switch in Settings no longer throws away other changes on that page that you haven't saved yet.
- **Fixed:** restoring a backup no longer brings back an update note you had already seen.

---

## 0.38.88 — Emergency lighting button at the top, and a switch to hide it (2026-09-28)

### Atlas — Test emergency lighting
- **Changed:** the red button now sits in the top-right corner of the house map, where it is on screen as soon as the Atlas opens. On a phone it is a quarter smaller.
- **Added:** Settings → UI Structure (Advanced mode) → Mapped Light Control → **Show the Test emergency lighting button on the Atlas**. Untick it and the button, and its checks, are gone.

---

## 0.38.87 — The free trial, where people will see it (2026-09-28)

### Trying the lighting map
- **Added:** when PadSpan updates, the "PadSpan HA updated" note on Overview now says **New: try the lighting map free for 90 days, no card**, with **Try it**. It goes away with the note.
- **Added:** once PadSpan is working in your house (someone is on the map, or a week has gone by), Overview shows one small card about the lighting half. **No thanks** or ✕ and it never comes back.
- **Added:** a quiet **💡 Lighting · free trial** line at the bottom of PadSpan's menu, until you have a key.
- Every one of them says so plainly: the presence tracking you're using stays free. None of them shows for an install with a licence key, and nothing here is a Home Assistant notification.

---

## 0.38.86 — The emergency lighting button is always on screen (2026-09-28)

### Atlas — Test emergency lighting
- **Fixed:** the red button sat at the bottom-right of the house map, which on most screens is below the bottom of the window, so you had to scroll to find it. It is now pinned to the bottom-right corner of the screen.

---

## 0.38.85 — Stable: WLED exact look, a 90-day trial where you need it, emergency lighting test (2026-09-28)

This stable release brings the 0.38.83 and 0.38.84 pre-releases (WLED lights that look the same every time) to everyone, with everything below.

### Before and after you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating.
- **The Atlas is now on for everyone.** It shows in the sidebar after the update restart. If you don't want it, turn it off in Settings; it stays off after that.
- **The free trial is 90 days, no card**, and you can now start it right where a paid feature stops you.

### Live data
- **Fixed:** on a house with many Bluetooth devices, the panel's live data could stop answering altogether, so the map and the top bar stayed empty. Every 5-second update rewrote PadSpan's whole "last seen in" file once for every device that had left, one after another. It now writes only when a device actually leaves a room, and saves are batched.
- **Fixed:** "last seen in the Kitchen" now shows when the device was last heard there. A device that left the same room again later shows the later time.

### Atlas — Test emergency lighting
- **Added:** a round red button in the Atlas's bottom-right corner, **Test emergency lighting**. It appears only when PadSpan finds emergency lights: any Home Assistant group with "emergency" in its name (every such group, nested groups included), or else WLED lights named "emergency". Nothing else is ever picked up. It takes no space of its own.
  - **Start:** every emergency light turns on. Lights that were already on are marked, and they stay on when the test ends.
  - **End:** only the lights the test turned on go off.
  - **Force off** appears beside the button during a test and turns every emergency light off. A light that can't be reached when the test ends is switched off when it comes back, unless someone set it by hand.
  - **The ring** around the button opens a card of every emergency light, with its state and its own on/off. A light you switch there during a test is left the way you set it.
  - **A real emergency wins:** if a Home Assistant automation with "emergency" in its name runs during a test (for example a power-failure automation), ending the test switches nothing off, and says so. Force off then asks for a second tap.
  - Home Assistant's own emergency automations are never changed.

### Atlas — WLED exact look (from 0.38.83 and 0.38.84)
- A WLED light's **Advanced → Sync & team** has **Who gives this light its instructions**: WLED sync or PadSpan (exact look). With PadSpan, the light comes on with its remembered look every time, after a power cut too. See the 0.38.83 notes below for everything it does.
- **Fixed:** a command you give (Atlas, room, card, preset, service) is never undone by an older change Home Assistant reports a moment later, and a team is never split by one. Found in the first live test on a real valance.
- **Fixed:** on Home Assistant 2026.10, `padspan_ha.wled_on` / `wled_off` aimed at an area or device still reach every light in it.

### Trial and buying
- **Added:** a **90-day free trial, no card** card wherever a paid feature stops you: the Atlas, Mapping → Atlas, Locate, Busy Times and Settings → PadSpan licence. Enter an email and it starts; someone who isn't a Home Assistant administrator is told an administrator has to start it.
- **Added:** until October 31, 2026, **PadSpan Pro for life** is $89 CAD, once, on padspan.traks.ca. A lifetime key shows as "lifetime".
- **Fixed:** a trial key that is bought, or upgraded to lifetime on the same key, no longer reads as a trial.

### Overview — Getting started
- **Changed:** the setup card is now **Getting started**, with a step **See someone on the map**. It shows on houses that haven't finished building their map, and goes away by itself once they have, whoever is home.
- **Fixed:** **Skip setup** and finishing setup are remembered now. They weren't saved before, so the card could come back.

### Help improve PadSpan (opt-in report)
- **Added:** **Become a tester**, beside the report in Settings → Presence → Help improve PadSpan. It is separate from the anonymous report: its own consent, its own send button, and nothing from it ever goes in the report. You can withdraw any time.
- **Changed:** panel errors are counted only when PadSpan's own code threw, and by the part of PadSpan that threw. Before, any error on the page was counted, including Home Assistant's own and other cards', and credited to whichever tab was open.
- **Added:** counts of where the trial offer was seen and started, and of the emergency test. Never an email.

---

## 0.38.84 — WLED exact look: a change you make always stands (2026-09-27)

### Atlas — WLED exact look
- **Fixed:** if you changed a light PadSpan runs (from Home Assistant, the WLED app or a wall panel) while PadSpan was still reading the device before switching it — for example while the device was busy, or during PadSpan's daily check of its LED setup — PadSpan could still send its older command a few seconds later and undo your change. Your change now stands: PadSpan doesn't send the older command, and an "on" you gave gets the remembered look at your brightness.

---

## 0.38.83 — WLED lights that look the same every time (2026-09-27)

### Atlas — WLED: PadSpan runs the light, with its exact look
- **Added (Bright and Pro):** a WLED light's Advanced → Sync & team has a new card, **Who gives this light its instructions**: WLED sync or PadSpan (exact look). With PadSpan, WLED's own sync is switched off on that device and every on and off comes from PadSpan. Its sync settings are saved first, and kept in PadSpan's backups. Switching back puts them back exactly, and is always allowed, with or without a licence. It needs a Home Assistant administrator.
- **Added:** Advanced → **Exact look**. **Remember this look** reads everything each part of the strip is showing (colour, white and warmth, effect, palette, brightness) and shows it to you before saving. There is also **Remember team look**, **Try it**, the last 5 looks with **Use this one**, and a line saying how the last on or off went.
- **Added:** turning on a light PadSpan runs brings back its remembered look exactly, on every part of a 5- or 6-channel string. PadSpan checks what the device reports and resends any part that didn't take, up to 3 tries. It checks again a second later in case a timer, a button or a wall panel changed it, and if something keeps changing it, the card says what.
- **Added:** **Put the look back when something else turns it on**, on by default. When Home Assistant's dashboard, voice, an automation or the WLED app turns the light on, it gets its look back and keeps the brightness it was given.
- **Added:** after a power cut, the light goes back to what PadSpan last told it: on with its look, or off. This works even when Home Assistant never showed the light as unavailable.
- **Added:** a light that was offline gets its command when it comes back. One that didn't answer while Home Assistant could still reach it is tried again after 10 seconds and after 1 minute, then the card says it wasn't switched. If someone changes the light in the meantime, their change stands.
- **Added:** a team can be run by PadSpan: Team card → **Run this team by: WLED sync | PadSpan**.
  - Every member gets its look at the same moment and keeps its brightness balance with the others. Effects start together.
  - A member switched from outside PadSpan takes the rest of the team with it, and a member that was offline catches up when it's back.
  - If one member can't be switched over, the others are put back.
  - A member of a WLED sync team can't be switched on its own: the team goes over as one.
- **Changed:** these lights are now switched by PadSpan, with their look, from everywhere in PadSpan: the Atlas (a tap, drag to dim, the light card, a room's or floor's all on/off), Whole House Presets, Vacation Mode and presence rules. So are the new services `padspan_ha.wled_on` and `padspan_ha.wled_off`. Map-scene Apply leaves them their look.
- **Added:** PadSpan rechecks each device's LED setup after a restart and once a day. If the outputs, LED types or firmware changed since the look was remembered, the card says what changed. PadSpan never changes the setup itself.
- **Note:** PadSpan never touches firmware, presets or playlists here. The only settings it writes are the sync settings, with a backup first. On an ESP32 that uses I²C, sync is switched off live only, and switched off again after every restart.
- **Note:** without a licence, Home Assistant switches every light as usual, and a team PadSpan ran is still switched together, members kept in balance. The light card offers to give each light back to WLED sync.

---

## 0.38.82 — Stable: everything since 0.38.48 (2026-09-27)

This stable release brings every pre-release since 0.38.48 — 0.38.49 to 0.38.81 — to everyone. The details of each are below.

### Before and after you update
- **Refresh the PadSpan page** in every browser and on any wall screen after updating. A page left open keeps running the old panel until it is reloaded.
- **Flood sensors:** every moisture sensor in Home Assistant now raises a red banner when it reports wet, and it stays for 2 days or until you press Reset — including a sensor that is already wet when Home Assistant starts. Nothing is sent anywhere.
- **Admin only:** backups, Forensics, adding or removing IRKs, the Sweet Home 3D import, capture files, the ESPresense Companion link and Vacation Mode now need a Home Assistant administrator account.
- **Moved:** Insights is now a mode of Traceback (next to the new Busy Times), and the new Locate is part of Follow. Old links open the new place.

### New since 0.38.48
- Flood sensors on the Atlas, with a latched alarm and an always-visible emergency banner.
- Whole House Presets and Vacation Mode.
- Busy Times and Locate (PadSpan Pro).
- The new Atlas layout, and doors, windows, locks and openers — including ones built from bare relays.
- Traceback's Full house activity, with 💡 Devices playback.
- A full WLED workbench in the Atlas card.
- AirTags and "works with Find My" tags keep their name across address changes (Settings → MAC Rotation Bridging).
- Security hardening, and the fixes and Home Assistant 2027 readiness in 0.38.81.

And the fixes that are new in this release:

### Guided Calibration (#88)
- **Fixed:** Guided Calibration's first two steps now update by themselves when Home Assistant's Bluetooth scanners and your devices show up — for example a minute after Home Assistant restarts — instead of saying there are none until you leave and come back.
- **Changed:** switching from Live to Sample now takes a second click within 3 seconds: the first click changes the button to "Show demo data?". A double-click or holding Enter doesn't count as the second click. Switching from Sample to Live is still one click.
- **Fixed:** on phones, the Data pill shows the right mode straight away and after every switch.

### Help improve PadSpan (opt-in report)
- **Fixed:** an AirTag away from its owner could be reported as near it, because one scanner's reading from hours ago won over every fresh one. It now counts as away when any scanner heard it say so in the last minute or so. Because of the same mistake, a tag going back to its day key was counted as a wrong link; it is counted as expected again.
- **Fixed:** a wrong link onto another tag that is still nearby was counted as a tag back on its day key. It now counts as a wrong link.
- **Fixed:** an address change PadSpan only saw part of (Home Assistant restarting right after it, or MAC Rotation Bridging switched off during it) was counted as "left range" or "came late". It is no longer counted at all.
- **Fixed:** "came a little late" counted other tags arriving where yours had just been. It now counts only what a real change could look like with your scanner settings. At the defaults, no real change comes that late, so nothing is counted there.
- **Fixed:** a tag leaving range just as a nearby tag changed address was counted as "too close to call".
- **Fixed:** anything counted while a report was being sent (up to 15 seconds) was lost. It now goes with the next report.
- **Changed:** the README's list of what the report carries now includes your saved Showcase preset values and the Automorph style, and gives the real size: a few KB.

---

## 0.38.81 — Guided Calibration never shows demo radios, HA 2027 ready, and the opt-in report learns how well AirTags are followed (2026-09-27)

### Help improve PadSpan (opt-in report)
- **New:** if you've opted in, the report now says how well **MAC Rotation Bridging** follows Apple Find My tags (AirTags and "works with Find My" tags) when they change address: how many changes were followed, and how many of those took over 2 minutes; how many weren't, and why — too close to call between two tags, or the new address came a little late; how many wrong links were undone by themselves or with **Unlink**. A tag that most likely just left range, or another device changing address somewhere else at the same moment, is counted on its own and never against it, and so is a tag going back to its day key, which is expected.
- **New:** it also counts the Find My addresses on the air right now, by kind (AirTag, Find My accessory, AirPods, Apple device) and how many are away from their owner — with MAC Rotation Bridging off too, so it shows where following tags would matter — and, with it on, the tags PadSpan follows. Counts only, as always: never an address.
- **Fixed:** a report too big for the 8 KB limit was refused whole, and on every day after it too until Home Assistant restarted. On a day that full, fewer of your saved Showcase presets go with it instead.

### Guided Calibration (#88)
- **Fixed:** on a live install, Guided Calibration could list PadSpan's demo radios (Living Room Hub, Bedroom Hub, Kitchen Hub) while the top bar read "Live", if Home Assistant was slow to answer — for example just after a restart. Demo data now appears only when you have chosen Sample mode; until Home Assistant answers, the top bar shows "…" and the page asks again by itself every few seconds.
- **Fixed:** an empty radio list no longer tells you to "Switch to Live mode" while you are already in it: it says it is waiting for live data, or that Home Assistant isn't reporting any Bluetooth scanners yet.
- **Fixed:** demo radios can no longer be placed or saved as scanners, and no calibration capture records them — calibration only records from Live data.

### Atlas
- **Fixed:** a motion sensor that dropped offline for a moment and came back showed "motion now" for 5 minutes and then a recent-motion ring for up to 6 hours. It now stays as it was — also on a screen left open across a Home Assistant restart.

### 3D Stack and floors
- **Fixed:** pressing Save on a map row in "Floor Assignment & Ceiling Heights" also changed which storey that floor is on. On houses whose Home Assistant floors have no Level set, one Save could merge two floors (for example Basement and Main) into one. Save now only saves the map's floor, stack level and ceiling height.
- **Changed:** when every floor has a Level set in Home Assistant (Settings → Areas, labels & zones → Floors), PadSpan takes each floor's storey from there. Until then it keeps the storeys it already had. If an earlier Save put two of your floors on the same storey, set a Level on every floor in Home Assistant to separate them.

### Health and backups
- **Fixed:** **Reset Spatial Model** failed every time and cleared nothing. It now clears scanner positions, beacon positions and barriers, after saving a backup you can restore from Manage → Backup & Restore. If that backup can't be saved, nothing is cleared; with nothing left to clear, it does nothing. Floor-plan placements, rooms, lights and calibration points are kept.
- **Changed:** PadSpan's own automatic backups (before a reset, an import or a conversion) are kept apart from yours — the last 3 of them — and never push out a backup you made. You still keep up to 3 of your own.
- **Fixed:** taking or deleting a backup while PadSpan was saving an automatic one could make one of the two quietly disappear, though it had been reported saved. Backups are now saved one at a time.
- **Note:** if you go back to 0.38.80 or earlier after this version, the first Create Backup there keeps only the newest 3 backups of either kind. Delete the automatic "Before Reset Spatial Model" backups first, or don't go back.

### Settings — Experimental Features
- **Fixed:** Apple Device Classification did nothing you could see, and promised labels it couldn't give. Switched on, a device's type now says what sent an Apple Find My signal — AirTag, Find My accessory (another brand's Find My tag), AirPods or Apple device — in Objects, Bluetooth → Advertisements and a device's details. It no longer claims iPhone, iPad or Apple Watch: nothing Apple sends over Bluetooth says which.

### Home Assistant compatibility
- **Fixed:** on Home Assistant 2026.9 and later the log filled with warnings that PadSpan reads Home Assistant's device list in a way that stops working in 2027.9. It now reads it the supported way.
- **Fixed:** Home Assistant warned at every start that PadSpan's device trackers use something it drops in 2027.7. A tracker still shows the room it is in, or "not_home" when away, and keeps doing so after 2027.7.

### Training and Overview
- **Fixed:** the "Master Map & Alignment" walkthrough and manual pointed at a Set Master button and an Alignment tab that no longer exist. They now walk through lining floors up in Mapping → 3D Stack.
- **Fixed:** Positioning Diagnostics showed an error instead of "No labelled devices found." on an install with no labelled devices.

---

## 0.38.80 — 💡 Devices playback fixed; floors stack like the signal model (2026-09-24)

### Traceback — 💡 Devices
- **Fixed:** playback with 💡 Devices could run twice as fast and stop with an error, and the timeline slider kept the wrong length, when the devices the map shows changed mid-playback (Home Assistant's device list arriving after the history, or a device hidden on the Atlas).
- **Fixed:** a lock linked to a wall was left out; lights and sensors on the outside floor, readings of sensors outside every room, and walls on floors that aren't drawn were counted although the map shows no change of them.
- **Fixed:** an air sensor switching between two words the map draws the same ("excellent", "good") counted as a change; a reading that settles a whole degree or percent away now counts once it has held for 10 minutes, at the moment it changed — a sensor dropping offline for a moment no longer starts that over.
- **Fixed:** without 💡 Devices, a door's wall disappeared; it is drawn closed.
- **Fixed:** tapping 💡 Devices twice quickly, or leaving and coming back while it loaded, could leave it half on.

### Atlas
- **Fixed:** right after an install or upgrade — or just after adding a floor in Home Assistant — floors whose height PadSpan had not synced yet could all be drawn on one plate, or swap places.
- **Fixed:** a floor removed from Home Assistant that PadSpan still has rooms on is drawn on its own plate, where PadSpan's signal model has it (a removed Outside floor stays outdoors, its gates drawn).
- **Fixed:** a light saved on a floor with no rooms could get an empty floor of its own on the map; it is drawn on the floor it stands on.
- **Fixed:** a storey two floors share (a garden beside the ground floor) had one name on the floor buttons and the floor sheet and another on the floor slider and the legend; it is "Main/Garden" on all of them, on the Atlas and in Traceback. The outside floor never names a storey.

---

## 0.38.79 — Truer Traceback replay, Find My tags hardened (2026-09-24)

### Bluetooth
- **Fixed:** right after Home Assistant or PadSpan restarted, devices heard minutes earlier could look freshly heard — Home Assistant hands over its recent history when PadSpan starts listening, and PadSpan stamped all of it "now". Each report now keeps the time it was really received — including history from before the last reboot.
- **Fixed:** if the system clock stepped back (a time-sync correction), live readings froze until the clock caught up.
- **Fixed:** when Home Assistant's Bluetooth runs in degraded mode, a device heard by the Home Assistant machine's own adapter could look older and older while it was still advertising (that adapter then reports an unchanged advert only once).

### Bluetooth — Apple Find My tags
- **Fixed:** for the minute or so after a tag changed address, its new address showed up as a second, nameless device (and stayed in the list afterwards).
- **Fixed:** a tag that goes back to an earlier address — a tag away from its owner keeps one key all day, so it returns to it after time near the owner — is followed there, instead of reading "away".
- **Fixed:** if a link was ever wrong, the tag's real address being heard again now undoes it by itself; **Unlink** shows only on the tag's current address and undoes exactly that one, and it sticks.
- **Fixed:** a restart could undo a correct link and lose the tag's name.
- **Fixed:** a tag back on an earlier address is confirmed by the next report, even through a passive Bluetooth proxy that repeats only every 30–60 seconds — and a single replayed report can no longer move it. After **Unlink**, a leftover report can no longer move it either.

### Traceback
- **New:** Full house activity has two modes. On its own it is your Atlas map with the tracked beacons playing back on it — no devices. Turn on **💡 Devices** (shown next to it) and the whole house plays back too: every device your Atlas draws, as it was through the chosen period — lights, locks and motion, doors and windows linked to a wall, and the temperature, humidity and air-quality readings of sensors placed on the map (a reading counts when it moves a clear whole degree or percent). Every tracked object plays along; each device that changed at the moment on screen is ringed on the map (a door or window along its wall) and named above it.
- **Fixed:** in Full house activity, devices with a room but no place on the map were folded into one "unplaced" chip, hiding what they did (an unlocked lock looked the same as locked); each shows now.
- **Fixed:** replayed lights lost what kind of light they are — Home Assistant no longer records a light's effect list or colour modes, so WLED strips lost their strip class and the codes of most devices shifted (104 of 183 in one house). They now keep their class, shape and code; what a light was doing then (colour, brightness) is never borrowed from today.
- **Fixed:** a sensor that last reported before the replay window read as freshly reported at the window's start.
- **Fixed:** a motion sensor that dropped offline and came back unchanged read as "just triggered" in the replay; a change made while it was offline is dated to when it went offline, and one that comes back "on" after a long outage no longer reads as stuck on.
- **Fixed:** real motion in the first minutes after a Home Assistant restart was hidden in the replay.
- **Fixed:** a light renamed since shows with today's name, shape and code in the replay.

### Atlas
- **Fixed:** the floor slider, the floor buttons and the floor list in the drawing named floors "L0", "L1" or "Floor 1" when Home Assistant's floors have no level set (the usual case) — they show their names.
- **Fixed:** tapping a floor's badge said "No floor record for this storey" for every floor but the lowest — or opened another floor, whose **All lights on** switched that floor's lights.
- **Fixed:** floors now stack exactly the way PadSpan's signal model stacks them — names like "Ground floor", "First floor", "Second floor" and "Garden" are recognised, and a floor with a name PadSpan doesn't know sits above the named ones instead of sharing a storey with one (a garage with no rooms could take Upstairs' name).
- **Fixed:** a door or window on an outdoor floor was found on the lowest floor's slab when you clicked it, and a wall on a floor with nothing drawn could take a click meant for the floor on screen.
- **Fixed:** with only some floors given a level (the 3D Stack's Save sets one), two floors could be drawn on one slab; and outdoor rooms could be drawn on the lowest floor when the floor list has no outdoor floor.
- **Fixed:** a floor's badge only listed that floor's lights but every active motion sensor in the house; it now lists that storey's, and two floors that share a storey are named and switched together.
- **Fixed:** a motion sensor that is offline or unknown no longer flashes as motion or wears the recent-motion ring.
- **Fixed:** after a restart, sensors that took up to 5 minutes to come back no longer all read as fresh motion (the grace was 2 minutes).

---

## 0.38.78 — Find My tags keep their room; faster Traceback with Automorph (2026-09-24)

### Bluetooth — Apple Find My tags
- **Fixed:** after a tag changed address, its room stopped updating — PadSpan kept listening to the old, silent address.
- **Fixed:** the Bluetooth tab showed a carried-over tag by its raw new address (and hid it in quiet mode) instead of by its name; the Monitor list now shows it with the Find My badge.
- **Added:** if PadSpan ever links the wrong tag (say, a visitor's AirTag arriving just as yours left), the tag's detail in the Bluetooth tab has **Not <name>? Unlink** — the address goes back to being its own device and is never linked to that tag again.

### Traceback
- **Fixed:** with Automorph on, Full house activity playback was slow (up to half a second a frame on a large house) — about ten times faster now.

---

## 0.38.77 — AirTags and Find My tags keep their name; Traceback looks like your Atlas (2026-09-24)

### Bluetooth — Apple Find My tags
- **Added:** AirTags and tags sold as "works with Apple Find My" change their Bluetooth address every 15 minutes near their owner's iPhone, and once a day (about 4 am) when away from it — and until now each change made a new, nameless object. With **Settings → Features → MAC Rotation Bridging** on, a tag you've named or followed now carries on to its next address, keeping its name, room, Traceback history and Follow. PadSpan links them only when it's clear: the same kind of tag, the old address has stopped (about a minute after the change, since Home Assistant reports some tags only every 30–60 seconds), the new one appeared at that moment, and your scanners hear it in the same place. It never joins a tag to an iPhone, AirPods or a different kind of tag, a tag already in range, or a visitor's tag arriving later; two tags lying together that change at the same moment are left for you to name again rather than guessed. The Bluetooth tab shows these tags with a Find My badge.
- **Fixed:** with MAC Rotation Bridging on, an iPhone could be linked to a pair of AirPods (every Apple device looked the same to it).
- **Fixed:** the help said AirTags are iBeacons and can be tracked through Bermuda's iBeacon support; neither is true, and it now explains what does work.

### Traceback
- **Changed:** Full house activity now draws the Atlas exactly as your Atlas tab does — Showcase and its theme, fit rooms, isolux, automorph, hidden device codes and "hide untouched" — with the daylight of the moment being replayed.

### Atlas
- **Fixed:** an Inverted door's health dot read it backwards ("Open for ~8h" while closed).
- **Fixed:** a garage-door or opening sensor can be linked to a wall from Rooms → RF Barriers too.

### Atlas — WLED
- **Fixed:** a WLED strip Home Assistant can't reach said "That light isn't a WLED device"; it now says Home Assistant can't reach it and gives its address.
- **Fixed:** changes made on another screen while a team was being set up could be overwritten; the team card stays safe to use while the tab repaints; the colour-order helper can put a busy strip back; saving the Sync settings no longer switches off "Send my changes"; Vacation Mode switches a device that a failed team setup already put back.

### Overview
- **Fixed:** live dots could freeze while a slider kept focus after Resume Normal.

---

## 0.38.76 — A full WLED workbench in the Atlas card (2026-09-24)

### Atlas — WLED
- **Added (Bright and Pro):** tapping a WLED light on the Atlas now shows **Controls | Advanced**. Advanced covers what WLED's own web page does, in one card, through Home Assistant (no need to open the device's page, and it works over HTTPS):
  - **Layout** — the strip drawn as it is, with segments you can drag to size, a live view of what the LEDs are showing right now, the 2D matrix view, and "Identify" to blink a segment so you know which LEDs are which. "Keep after restart" makes the current layout the one it boots with.
  - **Effect** — every effect with its own speed, intensity and option controls (named the way the effect names them), palettes and colours, for one segment or several.
  - **Presets & playlists** — save, rename and delete presets, build playlists, and pick what it starts with.
  - **LEDs** — outputs (LED type, pins, count, colour order), power limits, a colour-order helper that asks what you see and sets it, and the 2D matrix setup.
  - **Sync & team** — WLED sync, right now and saved, and **teams**: pick WLED devices to follow this one, and PadSpan gives the team its own sync group on each device. In Home Assistant you then control only the leader; the others follow over WLED. Vacation Mode switches only the leader. If a device can't be reached while a team is set up, every device that changed is put back; breaking a team up puts each device's old sync settings back.
  - **Settings** — the device's settings in sections, schedules, buttons, usermods and restart.
  - **Backup** — a backup of the settings and presets is taken automatically before every settings change, and you can download or restore one.
  - **Info** — version, uptime, Wi-Fi, memory and more.
- Changing a device's configuration needs a Home Assistant administrator; anyone can change what the light is doing. PadSpan never updates WLED's firmware.
- On an ESP32 WLED that uses I²C (for example a sensor or display usermod), configuration changes are refused, because WLED's own configuration upload wipes the I²C pins on those devices.

### Vacation Mode
- **Fixed:** switching Vacation Mode off and on again mid-trip (or a trip straight after another) could leave the house dark for the rest of the trip, because Home Assistant had already deleted the history from before the trip. It now keeps the last pattern it learned and uses it until a new one can be built.
- **Fixed:** a WLED strip that was offline at the moment Vacation Mode was switched on was never switched for the whole trip.
- **Fixed:** learning the pattern no longer pauses Home Assistant for a few seconds.
- **Fixed:** restoring an older settings backup no longer brings back that backup's old pattern.

### Doors, windows and locks
- **Fixed:** a door or lock that is offline showed as "no data" on the Atlas, but its card said "Open" or a red "Unlocked", and Overview's walls showed it open. All three now say there's no reading. In Traceback's Full house activity, doors no longer show open or closed while house history is still loading.
- **Fixed:** the Atlas list and its room and floor sheets now agree with the map: an offline door or lock says "No reading", and a door marked Inverted (like the Upper Garage Car Door) reads the right way round.
- **Fixed:** a door sensor shown in Home Assistant as a garage door or an opening now appears on the Atlas like any other door.

### Traceback
- **Fixed:** Reset in Full house activity now also forgets the saved floor.

### Other
- **Fixed:** a text box or list left selected on a wall screen with nobody touching it could stop the live view from ever updating again.
- **Fixed:** Overview's "Raw radio only" banner could stay up after pressing Resume Normal.
- **Changed:** the settings PadSpan sends to the browser are about half the size.

---

## 0.38.75 — Full house activity, fixed properly (2026-09-23)

An independent review of the last two releases found real problems behind a passing test suite. All fixed:

### Traceback — Full house activity
- **Fixed:** every motion sensor showed as "just triggered" at the start of every playback.
- **Fixed:** the house can now be replayed while nobody is home — each light, door or motion change gets its own moment on the timeline, and tapping an event in the list lands on it (it used to land just before it, showing the door still shut).
- **Fixed:** the event list was flooded by temperature and air-quality readings; it now lists lights, doors, locks and motion, and no longer jumps back to the top while playing.
- **Fixed:** watching history could change the brightness a light turns on at next time.
- **Fixed:** while history is loading (or if it fails) the map no longer shows today's states under a past time — there's a Retry.
- **Fixed:** the Floor slider picks the right floor on the Atlas map; long ranges (1–7 days) now cover the whole range instead of only the first few hours.

### Traceback — modes
- **Fixed:** Playback had no controls if Traceback was opened on Insights or Busy Times; the Full house activity switch showed up in the wrong modes; Insights could go blank when switching modes quickly; New Objects' pins could stay on screen after returning to Playback.

### Follow — Locate
- **Fixed:** a lost tag with no current room now says it's out of range and where it was last seen; following your own phone says so; directions now update every few seconds instead of every 35.

### Vacation Mode
- **Fixed:** with Home Assistant's default 10 days of history, a trip started on a Friday had no weekend data and left the house dark all weekend — a weekday without enough history now uses the same time on any day.
- **Fixed:** light groups are left to their member lights; a light left on when Vacation Mode is switched off isn't learned as your routine; switching it off mid-check no longer switches a light afterwards; a failed first build retries hourly instead of every 5 minutes; restoring a backup or a factory reset keeps its record of past vacations.

---

## 0.38.74 — Vacation Mode never learns from itself, and shows up in Traceback (2026-09-23)

### Vacation Mode
- **Fixed:** Vacation Mode rebuilt its pattern every day from the recorder while it ran — and the recorder can't tell a light Vacation Mode switched from one a person did, so it slowly learned its own output. Below 100% intensity each day came out dimmer than the last, and after about ten days (the recorder's default retention) there was nothing real left to learn from. It now builds its pattern once, from history up to the moment it was turned on, and leaves every earlier vacation out of later patterns too. A vacation already running keeps the pattern it has.
- **Added:** Vacation Mode keeps a small log of what it switched (14 days).

### Traceback
- **Added:** in Full house activity, lights switched by Vacation Mode are marked 🌴 in the event list, and the status line says when Vacation Mode was on at that moment — so you can check what it did while you were away, and tell its switching from a person's.

---

## 0.38.73 — Full house activity in Traceback; Insights, Busy Times and Locate move in (2026-09-23)

### Traceback
- **Added (PadSpan Pro):** a "🏠 Full house activity" option on Playback. Turn it on and Traceback shows your Atlas map instead of the 3D stack, and plays the whole house back alongside the beacons — every light (with its colour and brightness), door, window, lock and motion sensor as it was at that moment. Beacons keep Traceback's own markers and trails. The same play, scrub, speed, range and object filter controls drive it, and a list under the map shows every change in the window; tap one to jump there. House history comes from Home Assistant's own recorder (10 days by default), so nothing new is recorded; beacon history keeps 7 days.
- **Changed:** Insights and Busy Times are now modes of Traceback (Playback · New Objects · Insights · Busy Times) instead of tabs of their own — all three read the same history. Old links to either still land on them.

### Follow
- **Changed:** Locate is now an option on Follow — pick a tag, tap "📍 Locate", and it guides you to the tag you're already following, with no second pick to make. Still PadSpan Pro. Its own tab is gone; old links land on Follow with Locate on.

---

## 0.38.72 — Atlas's column layout is a Pro feature (2026-09-23)

### Atlas
- **Changed:** the two/three-column Atlas layout (map, table, and inspector side by side instead of stacked) is now gated to Pro specifically, not Bright — a Bright install no longer sees the column layout or the toggle that switches it, regardless of what was stored while it was open to everyone during its trial.

---

## 0.38.71 — Atlas's column layout, actually working (2026-09-23)

### Atlas
- **Fixed:** the two/three-column Atlas layout (map, table, and — on an ultrawide monitor — the inspector, side by side instead of stacked) has thrown a JavaScript error on every window resize since it shipped two days ago, silently never engaging. Found live during a full review of every 2D map screen in the app. No visible symptom beyond the layout never switching to columns — the map, table and index still worked, just always stacked.

---

## 0.38.70 — A plain light from a relay too (Pakedge PoE ports and the like) (2026-09-23)

### Devices
- **Added:** a fourth kind in the "Build an opener, lock, or light from relays" wizard — a plain light, for a bare relay (a Pakedge PoE port, a ProDino channel, anything switch./light.*) that switches a light with no other logic needed. No pulse, no travel, no interlock, no helper: the relay's own on/off IS the light's on/off, wrapped only so it shows up as a real `light.*` entity — grouped into rooms, usable in automations and dashboards — instead of a bare switch.

---

## 0.38.69 — The relay wizard's other entry point, under Atlas's own filter (2026-09-22)

### Atlas
- **Added:** a "+ Build an opener or lock from relays" button now sits directly under the Light Index's own "Filter the list by device type" pulldown in Mapping → Atlas — the other of the two spots originally asked for (only Devices → Door Openers got built at first). It jumps straight into that same wizard rather than duplicating it.

---

## 0.38.68 — Build an opener or lock from bare relays (2026-09-22)

### Atlas / Devices
- **Added:** Devices → Door Openers now has a "Build an opener or lock from relays" wizard at the bottom of the list, for a door or window with no ready-made opener/lock entity — just a relay. Three kinds, taken directly from patterns already hand-built elsewhere in this house rather than invented: a momentary opener (one relay, pulse-and-release — the same shape as the garage door scripts), a two-direction motor opener (two relays with a hardware interlock, a travel timer, and the same three boot-safe/failsafe automations the Bedroom1 window automations use), and a momentary-strike lock (one relay, remembers locked/unlocked since a spring strike has no position to read back). Every piece the wizard creates — script(s), automation(s), a Template cover/lock, and a state-memory helper when no sensor is linked — is a real Home Assistant object, built the same way HA's own Settings → Helpers → Template does it; "Remove" deletes exactly those pieces and nothing else. Researched Control4 for a real door-lock relay to design against: the front door's lock (item 607, category "locks") was never bridged into Home Assistant, so it can't be picked up by this wizard yet — the momentary-strike-lock kind is ready for whenever a lock relay like it (or the Kwikset Zigbee lock Garry is adding to the back door) is reachable from HA.
- **Added:** door/window openers can now be `script.*` entities too, not just `cover./switch./button.` — found Garry's own `script.garage_door_car`/`script.garage_door_truck`, the correct controller to trigger rather than the raw relay underneath it, invisible to Devices → Door Openers before now.
- **Added:** an Invert toggle on a linked door/window's row in Mapping → Atlas, for a contact sensor that reports the opposite of what's actually happening (confirmed on Upper Garage Car Door).

---

## 0.38.67 — A door/window's sensor, opener and lock, tied together (2026-09-22)

### Atlas
- **Added:** a linked door/window on the map can now have an opener (a garage door, gate, or any other powered opening) and a lock tied to it too, all three shown and controlled from the one card its wall opening's line already opens. New Devices → Door Openers tab marks which cover/switch/button entities are openers; a linked row in Mapping → Atlas then offers "+ Opener" and "+ Lock" right alongside its existing Unlink and Steel controls. A relay-style opener (most garage door switches) gets a plain Trigger button rather than Open/Close, since its own on/off doesn't reliably mean either — the door's real sensor reading is shown alongside it for context.
- **Fixed:** clicking a linked barrier's line on the Atlas sidebar panel (or the builder's "Preview as sidebar") could open the card without showing its opener or lock, even when one was linked — the click handler there rebuilds what it needs from the map's own drawing rather than looking the barrier up again, and two fields were missing from that handoff. Found and fixed testing live against two real garage doors.

---

## 0.38.66 — Click a door/window/lock line on the Atlas map (2026-09-22)

### Atlas
- **Added:** click a door/window/lock line on either Atlas screen (the sidebar panel, and Mapping → Atlas' own "Preview as sidebar" mode) to open a card showing whether it's open or closed, with a button to open/close or lock/unlock it when the linked entity actually supports that. A plain contact sensor (all of today's real doors) says so honestly instead of showing a button that would just fail. Bright/Pro only, same gate as every other placement/editing feature on this map.
- **Added:** when a door has a smart lock, its card shows the lock's own state and a Lock/Unlock button too, found automatically when the lock and the door sensor are the same physical device (an integrated smart lock reporting both). An open door always leads the card regardless of lock state; a closed door shows "Closed & Locked" or "Closed, Unlocked".
- The builder's editing-mode hold-to-jump-to-index-row gesture on these lines is unchanged; a plain tap there (previously a no-op) now opens the same card.

---

## 0.38.65 — The Atlas map's dead space, for real this time (2026-09-22)

### Atlas
- **Fixed:** both Atlas screens (Mapping → Atlas and the sidebar Atlas panel) were still drawing the house small and centered, with a lot of empty canvas down both sides — the thing v0.38.57–v0.38.64 kept trying to fix from the outside in. Two separate causes, both closed out now: the map's own internal scale picked whichever of width-fit or height-fit was smaller (a leftover "contain into a fixed box" formula), so it now scales to width alone, matching the "no height cap" rule the container side already followed; and four sensors had placements 30–40 metres from the house, which forces the map's frame to stretch out to include them — those four are back in the unplaced queue rather than distorting the canvas.

---

## 0.38.64 — The Presets row's real bug, and the zoomed-in flicker (2026-09-22)

### Atlas
- **Fixed:** the Presets / Whole House row was still wrapping to 3+ lines per bar. Root cause: a global `input[type="text"]{width:100%}` rule outweighs a plain class in CSS specificity, so the "save as" name field's own `width:150px` silently lost that fight and rendered at nearly the bar's full width, shoving Save/Delete onto their own line every time. Both bars now genuinely fit on one line each.
- **Fixed:** a visible flicker/jump when zoomed in, worst on every ~5s poll rebuild — the pan-position restore (v0.38.60/61) ran on a `setTimeout`, which still leaves the browser a chance to paint one frame at the wrong (0,0) scroll position first; at high zoom that's a full jump to the top-left corner, which could read as content getting shoved to the sides. Switched to `queueMicrotask`, which is guaranteed to run before the next paint — nothing left to flash.
- **Removed:** a ResizeObserver left over from the old height-fitting code that no longer did anything (width and height are both plain CSS now) but still re-ran on every resize.

---

## 0.38.63 — Atlas map sizing settled, zoom saved, presets side by side (2026-09-22)

### Atlas
- **Fixed:** the map's size on both Atlas screens. Across v0.38.59–v0.38.62 the new layout kept fitting the drawing to whatever vertical space the controls above it happened to leave — every attempt to measure that height and apply it before you could see a gap fixed one symptom and produced another (a flash every few seconds, then not filling the width, then the whole map shrinking and going short). The height cap is gone entirely: the map fills the full width and its height follows the drawing's own shape, exactly as the classic layout always did. Nothing is measured, nothing is deferred, nothing left to drift.
- **Added:** the Atlas zoom level is now saved with the rest of the view (Save view / Reset view), so the sidebar Atlas panel keeps the zoom you dialed in across reboots and reloads. Previously it silently reset to 100% every time the browser restarted — on a kiosk left running for months, that read as the map "getting smaller" again and again.
- **Changed:** the Presets (saved looks) and Whole House Presets bars now share one row side by side — Look on the left, Whole house on the right — instead of a tab that hid one behind the other.

---

## 0.38.58 — Vacation Mode banner fix, and the new Atlas layout is now the default (2026-09-21)

### Atlas
- **Fixed:** the Vacation Mode banner never actually showed or hid correctly — a CSS rule with the same specificity as the one meant to hide it, declared later in the stylesheet, always won, so the banner's visibility didn't track whether Vacation Mode was actually on. It also lived in the app's global chrome, showing on every tab; it's now built into the shared Atlas map instead, so it appears only on the two Atlas screens (Mapping → Atlas and the sidebar Atlas panel) and nowhere else, pinned dead-center of the screen rather than a top bar, and stays there until Vacation Mode is actually turned off.
- **Changed:** the reworked Atlas layout (v0.38.56's trial) is now on by default — "▦ Classic layout" in the Mapping → Atlas toolbar still reverts it per-install at any time.

---

## 0.38.57 — Vacation Mode (2026-09-21)

### Atlas
- **Added:** Vacation Mode — a permanent entry in the Whole House Presets list, right beside your own saved presets. Instead of replaying a single saved snapshot, it learns each light's own real pattern from Home Assistant's history (per day of the week) and keeps turning lights on and off to match it — with some randomness built in, so it doesn't look like a mechanical timer — until you turn it off. A banner shown on every tab while it's running carries an Energy Saving slider (100% down to 5%): lower settings mean fewer lights come on at once, for a lower-power version of the same idea. Turning it on requires an administrator account. Needs a few days of Home Assistant's own recorder history to build a useful pattern for a given light and time of day.

---

## 0.38.56 — Whole House Presets, and a trial of a decluttered Atlas layout (2026-09-21)

### Atlas
- **Added:** Whole House Presets — a "Set" button remembers every light and fan's real state (on/off, brightness, colour, effect, fan speed) under a name; picking that name from the pulldown puts the whole house back, including turning off anything that was off when it was saved. Applying is a two-click confirm, since it changes every light and fan at once. Locks are never included, on purpose — a saved preset must never be able to unlock a door. PadSpan Pro, same tier as the existing Presets.
- **Added (trial, off by default):** a reworked Atlas layout — Settings → Features → "New layout" in the Mapping tab. The map now fits the actual screen instead of scaling to the width of its box (previously a wider monitor meant a *taller* map and more scrolling); the toolbar's groups pack left-to-right instead of each forcing its own line; less-used controls (Automorph tuning, Layout & view, Showcase's extra toggles) collapse behind a fold instead of always showing; the two Presets bars share one row with a tab instead of stacking. The sidebar Atlas panel gets its own variant of this: the map runs edge to edge and every control becomes a drawer that opens over it from a slim icon rail, since that screen is the house map, not a workbench. One click back to the classic layout at any time.

---

## 0.38.55 — Security hardening, two flood-alarm reliability fixes, and a real flood marker (2026-09-20)

### Security
- **Fixed:** an independent security review found presence automations could fire ANY Home Assistant service against ANY entity (not just the turn-on/turn-off against lights/switches the UI actually offers) — a rule saved by a non-admin household or guest account could unlock a door on the next BLE arrival with no tap and no confirmation. Now enforced against the same allowlist the UI itself offers, both when a rule is saved and again at the moment it actually fires.
- **Fixed:** four groups of commands (backup create/list/restore/delete; forensics location history and raw-signal reads; the floor-plan Sweet Home 3D importer; adding/removing a Private BLE identity key) were reachable by any non-admin account, inconsistent with sibling commands in the same areas that already required an admin. All now require admin.
- **Fixed:** the Sweet Home 3D floor-plan importer only capped the compressed upload size — a small, crafted file could inflate to gigabytes when decompressed. Added a decompressed-size cap and rejected malformed XML outright.

### Flood sensors
- **Fixed:** two different flood sensors triggering within the same instant could silently overwrite each other's alarm — only the later one would end up latched, the other vanishing with no error. Properly serialized so both survive.
- **Fixed:** the always-visible emergency banner, the map's flood ripple, and the Mapping tab only refreshed their view of active alarms on boot, a manual Refresh, or switching back to the tab — a display just being watched (a wall-mounted kiosk, in particular) could miss a newly-tripped alarm indefinitely. Now refreshes automatically about every 30 seconds while live data is on screen, matching the sidebar Lights panel's existing behavior.
- **Fixed:** deleting a flood sensor's entity from Home Assistant used to leave its alarm behind forever — the emergency banner had no way to know the sensor was gone, and would keep showing it as active (identified only by its now-dead entity ID) for up to the full 2-day window. The banner now forgets an alarm the moment its sensor is deleted.
- **Added:** a flood sensor's marker finally has its own look — a wide, low, gently-scalloped puddle — instead of the plain default hexagon every unclassified fixture falls back to. The alarm ripple was always there; the marker itself just never read as "flood sensor" at rest.

### Atlas device map
- **Changed:** unified how every fixture class (lights, fans, locks, motion/door/flood/air-quality/humidity/temperature sensors) is recognized, labeled and counted across the map, sidebar and tables — previously each surface kept its own hand-maintained copy of "which classes does this apply to," and the copies had quietly drifted. Fixed several small inconsistencies this turned up along the way: a locked lock could read "Off" instead of "Locked" in some views, a temperature/humidity/air-quality sensor could get placed but never keep its assigned room, and room/floor summary totals only counted some classes.
- **Fixed:** the Turn On/Off button and tap-to-toggle on a lock in the Atlas builder called Home Assistant services that don't exist, so both always silently failed.
- **Fixed:** press-and-hold — used to jump to a device's row in the list, or to select a fixture for editing rather than dragging it — was measured in map-zoom units instead of real screen pixels, so it could fail to register (or misfire as a drag) depending on how far the map was zoomed. Also didn't work at all on doors, windows or locks, since those are drawn as invisible wall sections with nothing to press. Both fixed; holding now works the same way on every device, at any zoom.

### Documentation
- **Fixed:** the README and website's "N dedicated views" and "N animated walkthroughs" claims had drifted from the app's real counts (in more than one place, and to more than one wrong number).
- **Added:** flood alarm latching and the emergency banner — shipped two releases ago — are now actually documented, in the Atlas Guide and the in-app Training Hub.

---

## 0.38.54 — Fix: flood alarms never actually latched (2026-09-18)

### Flood sensors
- **Fixed:** the flood latch's event listener was registered as a lambda wrapping its `@callback`-marked handler. Home Assistant's dispatcher only recognizes the marker on the exact function object it was applied to — a lambda wrapping it is a different, unmarked function, so HA ran it on a worker thread instead of the event loop. The handler's `hass.async_create_task` call is only legal from the event loop, so every single trigger crashed with "calls hass.async_create_task from a thread other than the event loop" and the latch write silently never happened. In practice: a flood sensor's ripple would draw for as long as the raw sensor reported wet and vanish the instant it flickered off, the 2-day latch never engaged, and the emergency banner never had anything to show — confirmed live, `flood_latches` stayed `{}` in the settings store through repeated real trips. Switched the registration to `functools.partial(_on_state_changed, hass)`, which HA's dispatcher correctly unwraps to find the marker. No other flood behavior changed.

---

## 0.38.53 — An always-visible emergency-resets banner (2026-09-18)

### Flood sensors
- **Added:** a sidebar banner listing every currently-latched flood alarm by name, with its own two-click-confirm Reset button — visible regardless of which tab is open, instead of only wherever the sensor's own row happens to appear. Hidden entirely when nothing is latched. A matching red pill (🚨 N) in the mobile topbar covers phone/kiosk views where the sidebar is usually collapsed.

---

## 0.38.52 — Flood alarm latching: 2 days or until reset (2026-09-18)

### Flood sensors
- **Added:** an active flood alarm now latches — stays alarming for 2 days, or until someone resets it on the Atlas map, whichever comes first — instead of clearing the instant the sensor itself reports dry. Verified live against a real leak: a moisture sensor flapped on/off in a tight ~0.55s rhythm across three separate bursts, well under what a point-in-time state check or poll interval could reliably catch; only an event listener catching every transition (not raw `state`) sees a burst that short. A sensor that re-triggers while already latched keeps its ORIGINAL trigger time rather than extending the window (the ISA-18.2/NFPA-72 convention: an active alarm keeps its first occurrence).
- **Changed:** the flood ripple on Atlas is now a wavy, 7-lobed scalloped shape that grows out to the room's real edges and slowly rotates — three fast staggered ripples while actually wet, one slower ripple while latched-but-dry — replacing the plain expanding circles, which read too similarly to the motion sensor's pulse.
- **Added:** every row showing a flood sensor (the device table, the room/floor tap sheet) now reads WET / ALARM / DRY, with a two-click-confirm Reset button once latched — matching the same confirm pattern already used for untagging a BLE device. Room/floor "⚠ Emergency" counts (renamed from "Flood") now include latched sensors, not just live-wet ones.

---

## 0.38.51 — Flood sensor filter fix, and the class relabeled Emergency (2026-09-18)

### Flood sensors
- **Fixed:** the Mapping tab's inspector panel still showed a Turn On/Off button for a placed flood sensor — harmless (nothing on the other end of a click would have done anything), but wrong for a read-only class, the same gap 0.38.42 closed for motion/temperature/humidity/air quality. This is a second, independent copy of that exclusion list (maps.js's own inspector, not lights_map.js's row rendering) that 0.38.50 missed.
- **Changed:** the class relabeled Emergency in the Atlas filter chip, the room/floor aggregate sheet's summary line, the shape legend and the read-only state tooltip — reads as urgent at a glance, matching the bright red ring it draws. The underlying device_class ("moisture"), code series (K-series) and everything else from 0.38.50 are unchanged.

---

## 0.38.50 — Flood sensors, with a bright red ring radiating out while wet (2026-09-18)

### Flood sensors
- **Added:** flood/water-leak sensors join the Atlas map as their own class (K-series codes, bright red glyph) — placed, moved and selected exactly like motion, temperature, humidity or air quality. HA's own device_class for this is "moisture". A wet sensor draws a bright red ring radiating outward from its placed point, sweeping through its room — the same "make the room react" idea air quality's rising bars use, but binary rather than a graded scale: either wet right now, or nothing drawn at all. A room or floor with an active flood sensor calls it out in its aggregate sheet's summary line ("⚠ Flood ×N"), the same way Motion and Air already do. Deliberately excluded from the stuck-state health check motion and door/window get: an ongoing leak *should* keep alarming for hours, not get quietly flagged as "probably a hardware fault."

---

## 0.38.49 — Busy Times and Locate, two new PadSpan Pro tabs (2026-09-18)

### Busy Times
- **Added:** a room-by-room heat view of aggregate historical activity across every tracked object — total occupied time per room over the last 1/3/7 days, tinted from quiet to busy, with a 24-hour bar per room marking its single busiest hour. Built from the same data Insights already shows as tables (`padspan_ha/insights_get`); no new backend. A different lens than the live RSSI heatmap (scanner signal quality, not room activity) or Traceback (single-device history). PadSpan Pro — the underlying data stays free via Insights; this is a presentation-layer gate, the same pattern Automorph and Showcase already use over otherwise-free Atlas data.

### Locate
- **Added:** room-graph wayfinding. Pick which tracked device is yours and what you're looking for; Locate tells you which room to head to next, routed over your own room-adjacency map (Mapping → Rooms), refreshed on every live poll the same way Follow already is. Once you're in the same room it switches to a live metre-distance readout with a "getting closer"/"getting further" delta against the previous poll. Deliberately not camera-AR or compass-driven: no UWB hardware to do angle-of-arrival, and no reason to trust a phone's magnetic compass indoors, near BLE scanners and building wiring — this works the same on a wall-mounted kiosk with no camera as it does on your own phone. PadSpan Pro; "you" is a new setting (`locate_self_key`), refused server-side below Pro the same way `forensics_enabled` already is.

---

## 0.38.48 — Atlas: pinch-zoom stops fighting itself, and the click target matches what's on screen (2026-09-17)

### Atlas touch
- **Fixed:** on a touchscreen, the Atlas map's own pinch-zoom competed with the browser's own native pinch-zoom for the same gesture — the browser usually won, changing the whole page's zoom instead of the map's, and the resulting layout reflow could silently reset wherever you'd just panned to.
- **Fixed:** the Atlas map rebuilds itself completely fresh on every periodic refresh (not just when something it draws changes) — a fresh rebuild always started back at the top-left, discarding your pan position within seconds of setting it, independently of the pinch-zoom fix above.
- **Fixed:** with Automorph's aura replacing a fixture's plain icon, the actual tappable area had stayed pinned to a small fixed circle at the fixture's anchor point since 2026-09-11 — regardless of how large the visible aura painted. The click target now matches the aura's own shape.

---

## 0.38.47 — Ten near-identical Automorph styles replaced with six real new ones (2026-09-17)

### Automorph
- **Removed:** Circuit, Contour, Facet, Ink Wash, Stained Glass, Constellation, Pulse, Orbit Rings, Puzzle Piece and Shatter. A side-by-side render of every style showed they all decorated the same morphed outline with different linework — a dashed border here, dotted there — so the silhouette never actually changed, and at real map-marker size they all read as one soft blob.
- **Added:** Shard Burst (separate scattered fragments), Origami Fold (a few large flat folded panels), Ink Bleed (an asymmetric bleed, never smooth or symmetric), Rosette (a mandala of overlapping petals), Lens Flare (a receding chain of discs along one axis) and Mycelium (a branching filament network) — each reshapes the actual silhouette or composition, confirmed distinct at the size a marker is actually seen at, not just up close.
- **Kept:** Glow, Blueprint, Nebula, Halo, Spike Crown, Scalloped Wave, Bloom, Geode Cluster, Honeycomb and Block Extrude.

---

## 0.38.46 — Automorph now morphs the shape you actually chose (2026-09-17)

### Automorph
- **Fixed:** Automorph's room-alignment morph only ever started from a real outline for three shapes — circle, bar and square. Every other choosable shape (pendant, sconce, chandelier, triangle, diamond, line, lock, door) silently fell back to the same plain hexagon, so no matter which of the ~12 shapes a fixture was set to, Automorph morphed the identical hex outline every time. Each of those nine shapes now morphs from its own real silhouette — the same one the plain, non-Automorph glyph already draws.

---

## 0.38.45 — A tap on a device now always switches it, and the Atlas map's touch targets actually line up (2026-09-17)

### Tapping a device
- **Fixed:** in the Atlas builder's own map (Mapping → Atlas), a plain tap on a light, fan, lock or other device SELECTED it for editing instead of switching it — the one surface in the whole app where tapping a device did nothing to it. A quick tap now toggles the device first, exactly like the sidebar and Preview-as-sidebar already do; a genuine still hold (or Shift/Alt) selects it for editing instead, and dragging still moves it. This is also the direct explanation for the browser's own "pick one" list occasionally popping up on a single press: a tap that silently selected instead of switching invited pressing again or holding longer, which is what fires that menu.
- **Fixed:** the sidebar's own light-index row long-press (opens the WLED/effects popup) gave no warning while held — no gold ring, no lock against the row swallowing the gesture as a scroll. It now matches every other hold in the app: the same ring, drawn into the row's own shape icon.

### Touch targets on the Atlas map
- **Fixed:** a background floor's own translucent overlay never stopped absorbing taps meant for whatever was drawn on top of it — its own invisible layer stayed "live" underneath the floor you were actually looking at, on both the Atlas builder and its sidebar.
- **Fixed:** a marker on a floor you're not currently focused on could still steal a tap meant for the floor in front of it, for the same reason.
- **Fixed:** a device's code label could sit close enough to a crowded neighbour to catch a tap meant for that neighbour — now pulled in the same way the tap-target halo already was.
- **Fixed:** a handful of hit-testing gaps (an outdoor perimeter shape with no tap target of its own, a floor's own selector badge, a resize/rotate handle left mid-drag by an interrupted touch, a room name's hold racing the browser's own scroll) that could each independently make a touch land somewhere other than where it visibly was.
- **Fixed:** on the Mapping tab, a pinned toolbar could end up floating over the map's own markers instead of sitting above them, since the two scroll independently — the toolbar now reserves the exact space it needs.

---

## 0.38.44 — Nineteen Showcase themes you can tell apart, and a presets bar that says which box is which (2026-09-16)

### Showcase themes
- **Removed:** Editorial Minimalist, Elevated Architectural Blueprint and Nightscape City Lights. A similarity pass over all 22 themes found each within a hair of a theme it added nothing to — the concept lived in the name only. A saved look or a live setting that still names one falls back to Classic rather than breaking.
- **Changed:** ten themes reworked so that every one of the nineteen has one hook no other theme shares, spread across shape as well as colour: **Neo HUD** is cyan linework with bright cyan room edges and the tightest light pools; **Luxury Real-Estate** is the simple one — white marble and brass on a light ground, hairline edges, next to no glow; **Aurora** is the soft one — a green-to-violet curtain, the biggest room glow and widest pools; **Retro-Futurism** is the bold one — a full orange-to-magenta-to-indigo sunset with hot-pink room edges; **Bold Neon Precision** is electric-violet neon-tube outlines with acid-green fixtures; **Art Deco** finally draws the gold room linework it always promised; **Automotive HUD** is a brushed-alloy mid-grey cockpit with a gauge-LED amber; **Wabi-Sabi** is sparse matte stone-grey washi with a matcha accent, against Hygge's dense cosy tan; **Organic Bioluminescent** is the edgeless one, its glow in the fixtures rather than the rooms, in a deep-sea blue-white; **Holographic** gets a pink-to-lilac-to-cyan wash. Measured, not eyeballed: the two most similar themes in the set are now further apart than the two most similar were before by more than double.
- **Unchanged:** the twenty Automorph styles were audited too and left alone — each is its own drawing routine, not a variation.

### Atlas presets
- **Fixed:** the presets bar's "Select a look" dropdown and its name box were styled as the same dark pill side by side, so the dropdown read as a second name field and swallowed what you typed into it. The dropdown now leads with a chevron and the name box says what it is for.

---

## 0.38.43 — The Lights tab and panel are now Atlas (2026-09-16)

### Renamed
- **The Lights tab, and the separate Lights sidebar panel, are now called Atlas.** The device map behind that name covers a lot more than lights now — motion, temperature, humidity, air quality, locks and doors alongside fixtures — so "Lights" undersold it, and "Bright" was already spoken for: it's the name of a licence tier (`free`/`bright`/`pro`) that gates part of this very tab, and of the separately-distributed PadSpan Bright edition. Atlas doesn't collide with either. This changes what you see, not what anything does: `Mapping → Lights` is `Mapping → Atlas`, the standalone sidebar entry reads Atlas instead of Lights, and every help-manual heading and tooltip naming it follows suit. The device-class filter chip still labelled "Lights" — the one that isolates actual light fixtures from motion, temperature and the rest — is untouched; that's a different thing keeping its own name.

---

## 0.38.42 — Humidity sensors, a placement bug fixed, and the hold-ring everywhere (2026-09-15)

### Placing a sensor now actually shows a marker
- **Fixed:** placing a motion, temperature, humidity, air-quality or lock sensor with "Hide untouched" on left the marker invisible — both while dragging it into place and forever after saving, with nothing left to see, drag or confirm ("I did place the air sensors, the placing tools don't work"). These classes draw a fixed glyph and border colour with nothing of their own to size, rotate or recolour, so the untouched heuristic could never be satisfied by them. A bare position now counts as touched for all five classes, the same way a linked door already did.

### Humidity
- **Added:** humidity sensors join the ceiling map as their own class (H-series codes, indigo glyph), placed, moved and selected exactly like temperature. A live reading shows as digits ("47%") when placed and reported within the hour, falling back to its code otherwise.

### Placement, tidied up
- **Changed:** the row placement button now reads "+ Place" / "◎ Queued", matching the "+ Add room" / "◎ Queue all unplaced" wording already used elsewhere on this map, instead of a plain "Place"/"Queued" label.
- **Added:** the press-and-hold ring — the gold circle that fills in as you hold, already used on the map's preview surface — now shows on the Mapping tab's own builder too, for both holding a room name and holding a device marker to jump the list down to it. No change to what the hold does, only what it looks like while you're doing it.

---

## 0.38.41 — Outdoor gear on the floor map, temperature tints, clickable plates, hover HUD everywhere, quiet motion after a restart (2026-09-14)

### Placing outdoor gear
- **Fixed:** a device whose HA area is on the Outside floor (a shed, the garden, the driveway) could not be placed on the map at all. The floor stack never draws outdoor rooms, and a device's floor always came from its room first, so every placement path wrote it straight back off the map. An outdoor room no longer anchors a device's floor: drop it with the pin, or queue it and tap the map, on any real floor plate — just outside the room it lives beside — and that is where it draws. Nothing already saved moves.
- **Changed:** the drop-marker pin and the queue's tap-the-map both land a first placement on the floor plate you actually dropped it on (by geometry against the plate), instead of always the lowest storey.
- **Changed:** the inspector says so for an outdoor-room device — "its room is outdoors — drag the pulsing pin onto the floor it sits beside" — instead of asking you to assign a room.

### Temperature readouts
- **Added:** a live temperature reading tints its marker and digits — blue under 20°, red at or above 20°, bright orange over 34°. Only a live readout (placed, reported within the hour) is tinted; a stale or unplaced sensor keeps its plain marker. The sidebar shows the same.

### Clicking what you can see
- **Fixed:** devices placed outside a room on a real floor could not be selected. In the exploded stack the next storey's floor plate overlaps a lower plate's back edge, and the plate took the click — the marker was visible through it but unreachable. Floor plates never take a click now; the floor badge still does.
- **Fixed:** the hover HUD "stopped working" — it was working, drawn above the window once the page was scrolled, and then, pinned to the top, exactly under the sticky toolbar. It now sits at the top-left of the visible map, below the toolbar, wherever the page is scrolled.
- **Added:** the same hover HUD in the **Lights** sidebar. There, an "Under" row does what a tap on that marker does — motion opens its activity, a dimmable or strip opens its controls, anything else toggles.

### Motion sensors after a restart
- **Fixed:** after an HA restart every motion sensor on the map flashed for five minutes and then walked the whole six-hour colour ring, because a restored entity's last change is the boot moment. The integration now records when it started; a quiet sensor whose only timestamp is the restart draws nothing until it actually changes. A sensor honestly reporting motion at boot keeps its pulse.

---

## 0.38.40 — Stable promotion of the Mobile Mapping fixes and Lights builder crash fix (2026-09-14)

### Promoted to stable
- **Changed:** everything in 0.38.39 below, promoted from beta to stable — no code changes since.

---

## 0.38.39 — Mobile Mapping fixes, a searchable calibration beacon picker, and a Lights builder crash fix (2026-09-13)

### Three contributions from Alfiegerner, merged with follow-up fixes
- **Fixed:** dragging a receiver marker on a phone (Mapping → Edit) moved it a short distance and then stopped. Every touchmove rebuilt all the markers, which detached the one under the finger, and the browser sent the rest of the gesture to the detached node. The marker now moves live and the list commits once on release. The same detachment also left the panel's drag guard stuck on after every phone drag, so the panel stopped refreshing until a reload — fixed by the same change, and an OS-cancelled gesture (a call, a browser takeover) now releases cleanly too. ([#74](https://github.com/gbroeckling/padspanHA/pull/74))
- **Added:** tap an already-placed receiver on the Mapping page to edit its label and room, on a phone as well as on a desktop. Previously a tap on mobile never opened the editor, and a placed radio had no edit path short of deleting and re-adding it. Placed rows in the Live BLE Radios list gain an **Edit** button. A tap applies no movement at all until the finger has travelled more than 10px, so selecting a receiver can never nudge it. ([#76](https://github.com/gbroeckling/padspanHA/pull/76))
- **Changed:** the calibration beacon device list is a searchable picker instead of a long native dropdown: search by name, stable id or MAC, tracked devices stay RSSI-sorted, raw advertisements keep their own group. Fully keyboard-operable (arrows, Home/End, Enter, Escape) with screen-reader roles. Typing highlights the top match and Enter only picks a highlighted row, so tabbing into the field and pressing Enter can no longer silently select a device. ([#70](https://github.com/gbroeckling/padspanHA/pull/70))

### Lights builder
- **Fixed:** the Lights tab crashed outright on render for about a day: two helper functions used `el` without binding it from `ctx.helpers` in their own scope. Both fixed, and a new static scope check fails the test suite if this class of bug comes back.
- **Fixed:** the hover HUD always reported an empty stack live because it captured the map's root node once, before the map was attached to its shadow tree. It now resolves the root on every hit-test.
- **Added:** a sticky hover HUD in the map's upper corner names what a click would land on, with every marker stacked underneath it as clickable rows; **Alt+click** cycles that stack, so a device buried under another marker is reachable without a picker.
- **Fixed:** markers get an invisible baseline hit-circle and code labels a hit-rect, so thin or rotated glyphs and the plain label text are clickable everywhere, not only on their painted pixels.
- **Fixed:** room names floated outside their own room on isometric floors (18 of 21 real labels landed outside). The base position now blends toward the room's actual top corner and the fixture-dodge step moves along the same safe line. Live: 21 of 21 inside.
- **Fixed:** the canvas clipped the topmost room of a 3-floor stack and the left edge of floor slabs; the viewBox now follows the drawing's real extent on all four sides. Room names also step out of the way of temperature readouts and of names already placed on the same floor.
- **Changed:** transform mode shows a dashed box, reference line and stand-in glyph tracking a move-drag live; a second toggle tap inside the 2.5s optimistic window reverses the first command instead of repeating it; a press refreshes the poll-render guard immediately, closing the gap before the 8px drag arm where a poll could rebuild the map mid-gesture.
- **Added:** toolbar controls grouped under Presentation / Filters / Automorph / Layout & view; linked door/window rows get Unlink and Steel toggles; the Lights sidebar gets an Apply-only preset bar, and a preset may carry the floor / spacing / left-right layout (optional, so older presets never move the camera).

---

## 0.38.38 — Stable promotion of the 3-month PadSpan Bright Pro trial (2026-09-11)

### Promoted to stable
- **Changed:** everything in 0.38.37 below, promoted from beta to stable so HACS's default channel picks up the trial — no code changes since.

---

## 0.38.37 — A one-time 3-month PadSpan Bright Pro trial, no card required (2026-09-11)

### Try light placement on your own house before buying
- **Added:** an install with no licence key gets a **Start 3-month free trial** button in Settings → Features → PadSpan licence — one email, no payment info, no reinstall. It mints a real trial key through the same licence-server path a purchase uses, so it gates identically: expiry, the 14-day grace window and the editing-only gate (nothing already placed is ever lost) all apply exactly as they do for a paid key, with no separate logic anywhere. One redo is allowed if it's needed again (matched on email or install id, so rotating just one of the two doesn't reset it); the licence server also throttles by requesting IP so a script can't mint a stream of fabricated identities. The free-lighting paywall banner and the tiers wizard both now point at it instead of asserting no trial exists.

### Showcase preset telemetry groundwork, and a shrunk Lights map floor index
- **Added:** opt-in telemetry now includes up to 10 of an install's saved Showcase preset *values* (never the preset's own name), giving a future top-10 pulldown real data to learn from.
- **Fixed:** the Lights map's floor index used to draw one row per floor, so a multi-storey house grew a legend taller than the map itself — every floor now shares one line, and the canvas height shrinks to the real footprint instead of always reserving the worst-case size.

---

## 0.38.36 — A backwards-reporting door sensor now reads correctly, and two real Showcase-preset bugs fixed (2026-09-11)

### A door/window sensor that reports backwards can now be told so
- **Fixed:** the Lights map and Overview both assumed a linked door/window sensor's `state=="on"` always means open. At least one real sensor (a HOBEIAN vibration sensor doing duty as "Upper Garage Car Door Contact") reports backwards — `state=="on"` means closed. Both views' barrier-draw code (two separate copies of the same open/closed logic) now honour a new per-wall **Invert** toggle, added next to Delete in the Rooms wall-list row. Confirmed live: this specific door now reads correctly.

### Two real bugs found by a structured code review, both fixed
- **Fixed:** saving a Showcase preset once 50 already existed silently discarded the just-saved one while still reporting "Saved ✓" — the 50-preset cap kept the oldest 50 instead of the most recent 50. Also fixed: saving a preset immediately after changing a Showcase/Automorph control, before that change's own save finished, could capture the value from *before* the change instead of what was on screen. Neither had a test before today; both do now, alongside 10 more tests for preset validation that also had none.

---

## 0.38.35 — Showcase and Automorph redesign: 21 themes, 9 new aura shapes, and a preset system (2026-09-10)

### Showcase gets a Theme picker with 21 new palettes
- **Added:** Garry called Showcase "a big disappointment," specifically flagging the mint-green light pools as too bright, and asked for a redesign "using the latest in UI design." Twenty distinct high-end visual directions were mocked up and reviewed live, then all twenty were built as real, selectable themes rather than picking a single favourite. A new **Theme** dropdown sits next to the Showcase toggle in Mapping → Lights: Cinematic Glass, Neo HUD, Editorial Minimalist, Ambient Premium, Dataviz Precision, Organic Bioluminescent, Elevated Blueprint, Material You, Neon Precision, Luxury Real Estate, Wabi-Sabi, Hygge, Aurora, Automotive HUD, Art Deco, Swiss Style, Bauhaus, Nightscape, Holographic and Retro-Futurism, alongside the original **Classic** look (unchanged, and still the default). A 21st theme, **Obsidian Noir**, was added afterward — Garry: "one of the themes need to be mostly black, that is missing" — near-black everywhere with a warm brass accent so the light pools themselves stay the only bright thing on screen. Every theme repaints the same fixtures, rooms and floor stack — nothing about what Showcase draws changes, only the palette it draws with. Verified against a room with 5 lights as well as single-light rooms, so overlapping light pools were checked in every theme, not just isolated fixtures.

### Automorph gains 9 styles that change the actual aura SHAPE, not just its paint
- **Added:** every one of Automorph's original 11 styles painted the exact same silhouette (a fixture's own room-morphed outline) in a different colour or line treatment. Garry: "need more options that generate differing shapes... really dig for top notch options." Nine new styles instead modify the real boundary or fill geometry: **Spike Crown** (a jagged star/gear outline), **Scalloped Wave** (a smooth wavy shell edge), **Bloom** (rounded flower petals), **Geode Cluster** (a multi-core fractured-crystal fan), **Honeycomb** (a hex-tessellated interior), **Orbit Rings** (concentric tilted ellipses with orbiting satellite dots), **Puzzle Piece** (an interlocking jigsaw-tab boundary), **Block Extrude** (a raised 3D plinth with lit top and shaded side walls) and **Shatter** (a cracked-glass fracture web). Two more candidates (a pleated-paper fold and a fine sunburst) were built and cut for reading too similarly to Spike Crown's jaggedness once several fixtures shared a room, matching this session's established "build extra, keep the best" process.
- **Fixed:** a real bug found while building these — an internal style-name whitelist inside `iso_lights.js` was a bare literal array duplicated separately from the Style dropdown's own list and the backend's validator, so a style added to the dropdown silently rendered as "Glow" if that one array wasn't also updated; caught by comparing rendered shapes against what was expected. All three now derive from one exported registry (`AUTOMORPH_STYLE_LABELS`), so a future style only needs adding in one JS place plus the backend's own Python whitelist.

### A preset system for the whole Showcase "look"
- **Added:** Garry: "we now have thousands of combinations in the mapping, lights setup, we need to build a preset system... clearly separate from all other settings on that tab." Mapping → Lights now has a **Presets** picker — its own violet-tinted box below the main toolbar — to name and save the current Theme + Automorph (enabled/room%/hardness/style/subtlety) + Fit room/Isolux/Beacons/Codes combination, then recall or delete it later. Applying a preset is one settings write covering everything it captured.

---

## 0.38.34 — An open door/window now draws nothing at all, not a coloured line (2026-09-10)

### Open no longer draws a line at the doorway
- **Fixed:** Garry, repeatedly: "the doors when open show a grey line where the door is, I want nothing there." A linked door/window's open state was drawing a dashed accent-coloured line across the opening instead of a true gap. Open now draws nothing for the wall section itself — the two purple dots marking where the opening is still show in both states, only the line is gone. Closed is unchanged (solid grey line).

---

## 0.38.33 — Automorph styles pushed much bolder, and three new ones: Halo, Pulse, Chevron (2026-09-10)

### The 8 styles fixed in 0.38.32 were still too subtle
- **Changed:** Garry, testing live: "the styles are still way to subtle." Rescaled Circuit, Contour, Facet, Ink Wash, Stained Glass, Engrave, Constellation and Woven again — this time well past the original three's own magnitude rather than merely matching it — thickened key strokes, and raised Stained Glass's fade-in floor so it isn't washed out at low slider percentages. Constellation's "on" spoke lines also had a real bug fixed along the way: their opacity multiplied by `t` alone, so at slider 0 they were exactly zero regardless of state.

### Three new Automorph styles: Halo, Pulse, Chevron
- **Added:** **Halo** — one thick, near-opaque ring plus a soft blurred glow, built purely to be unmistakable at a glance with no fine detail to lean in for. **Pulse** — a solid ring with a wave of size-varying dots travelling around it, phased by the slider. **Chevron** — hazard-tape chevron ticks around the ring, pointing outward when on and tucked inward when off.

---

## 0.38.32 — A linked door/window/lock wall always shows now, and 8 Automorph styles that were rendering invisibly (2026-09-10)

### A linked door/window/lock wall always shows on the Lights map, regardless of any filter
- **Fixed:** after linking a door to a wall, nothing showed on the map at all — not even the grey "closed" line, whatever the door's real state. `lightIsTouched` always returned false for any door, so "Hide untouched" hid it and its wall segment right back; a linked door now counts as touched. Garry: "any setting should not negate a door showing up properly" — a linked wall's open/closed (or locked/unlocked) state is load-bearing information about the house, not clutter, so it now ignores hiddenEids entirely and is immune to the layer-chip class-filter dim as well, while every other filter still applies normally to ordinary lights. The closed-state line also renders at full opacity now instead of 0.85, so it reads as a definite, solid wall next to the dashed open state.

### Eight Automorph styles were painting real geometry nobody could actually see
- **Fixed:** Circuit, Contour, Facet, Ink Wash, Stained Glass, Engrave, Constellation and Woven — the 8 styles added in 0.38.30 — used opacity values roughly 5-15x fainter than Glow/Blueprint/Nebula, so switching to any of them looked like nothing happened. Rendered all 11 side by side to confirm and rescaled each style's opacity into the same visible range the original three already use. Engrave's crosshatch also mispositioned outside the room it was meant to trace — its clip-path needed an explicit `view-box` reference, found by testing live in the browser.

---

## 0.38.31 — A Free/Bright/Bright Pro/Pro onboarding wizard, and a stale "not released" claim fixed (2026-09-10)

### A new wizard explains what each tier actually unlocks
- **Added:** Settings → Features → PadSpan licence now has a **"What does each tier unlock?"** button — a short, 3-step walkthrough (what's always free, the tiers, upgrading) separate from the existing Maps/Calibration setup wizards and the Lights builder tour. It reads this install's own edition and only ever describes the tier ladder that install can actually buy into. A matching help card ("?" on the wizard) covers the same ground as a static reference for anyone who just wants to read it.

### The marketing site no longer claims PadSpan Bright isn't out yet
- **Fixed:** padspan.traks.ca still said the standalone PadSpan Bright download was "Not yet released" — it has been public since 2026-09-09. The page now links the real download and describes the current, live state.

### A door-circle wall-picker defect, found while digging into a still-open report
- **Fixed:** the "which wall is nearest my click" comparison, used when first placing a door/window/lock circle, measured distance in a way biased toward one screen direction over the other instead of plain on-screen proximity. Not confirmed to be the cause of the "circle is drawn in the wrong place" report still under investigation, but a real, provable defect on its own.

---

## 0.38.30 — Beacons are opt-in, 8 new Automorph styles, better door-circle diagnostics (2026-09-09)

### The beacons overlay is now opt-in, off by default
- **Changed:** the working-beacons overlay added in 0.38.29 now needs an explicit **Show beacons** toggle in the Mapping → Lights control row — Garry: "should be selectable, and off by default." A beacon's own name text now also follows the existing **Hide codes** toggle instead of always showing, so there's one declutter switch for identifier text, not two to remember.

### Eight new Automorph aura styles
- **Added:** Circuit, Contour, Facet, Ink Wash, Stained Glass, Engrave, Constellation and Woven join Glow, Blueprint and Nebula in the Style dropdown — Garry: "dig around hard for 5 more candidates... look at what other options are out there in the artistic world." Each paints the same morphed ring every existing style shares, just with a genuinely different visual grammar: electrical continuity (solid vs. broken trace), topographic contour bands, a faceted low-poly fan lit from one side, a soft ink-wash brush stroke, leaded stained-glass panes, a banknote-style crosshatch, a sparse star chart, and a woven over/under interlace. All stay inside the existing greyscale-only, opacity-budgeted material system — switch freely, purely a look.

### The door/window circle tool's save error carries more detail
- **Improved:** "Move or resize the circle so it crosses a wall" now names the nearest wall, how far its edge is from the circle, and the floor and coordinates involved, to help pin down a still-open report of the save failing on a circle that looks correctly placed.

### The opt-in usage report now covers more of the Lights builder
- **Added:** whether Isolux, Automorph and the beacons overlay are switched on, and which Automorph style is chosen, now count toward the existing opt-in "help improve PadSpan" report (Settings → Presence). Off by default, like every other counter here — nothing changes unless that switch is already on.

---

## 0.38.29 — Locks on the wall, working beacons on the map, closer markers stay clickable (2026-09-09)

### A lock can now be linked to the wall section it's mounted in
- **Added:** a `lock.*` entity keeps its ordinary point marker on the Mapping → Lights map exactly as before, and now ALSO offers **Link wall** in the Map column — the same circle-placement tool the door/window opening uses. Locked reads as a plain closed wall, the same grey a closed door/window already draws; unlocked flashes red on that wall section instead of drawing a blank gap, since a lock doesn't physically open the wall the way a door does.

### Working, proven beacons now show on the Mapping → Lights map
- **Added:** a tracked BLE/iBeacon device the positioning engine has actually located, and that's either identified or carries a name you gave it, now draws as a small teal dot with its label — the same colour Overview already marks a proven beacon with. Read-only: no click, no placement, nothing invented for a beacon with no real position yet.

### Two clickable-marker fixes
- **Fixed:** two markers placed close together could have OVERLAPPING invisible tap targets, so a tap that looked like it landed on one marker's own visible shape could still fire its neighbour instead. Each marker's tap target now shrinks to stay clear of its nearest neighbour, never below its own glyph's own size.
- **Fixed:** a light selected on the map could still silently absorb an arrow-key press minutes later — the map keeps keyboard focus for as long as nothing else takes it, so a key meant for something else entirely (scrolling, typing elsewhere) could nudge a stale selection with nothing on screen to notice by. Nudging now only happens while the pointer is actually over the map.

---

## 0.38.28 — The door circle's Done moves to the usual Save bar, and its errors say why (2026-09-09)

### Committing a door/window circle now uses the same Save bar as everything else
- **Moved:** the circle tool's own "Done" button is gone. Once a circle is placed, an amber "Unsaved door/window opening" bar appears at the top of Mapping → Lights, with **💾 Save opening** and **Discard** — the exact same bar every other draft edit on this map already uses, not a one-off button buried in the row (Garry, 2026-09-09: "the done should be the commit normally used at the top, not it's own unique thing"). The row itself now only offers **Place**/**Cancel**.

### The circle tool's error message says what actually went wrong
- **Fixed:** "Move or resize the circle so it crosses a wall" used to show even when the circle visibly did cross something — a room's own outline, which this tool has never recognized as a wall; only a wall drawn in Rooms → RF Barriers counts. The message now says that directly, and a floor with no walls drawn at all gets its own message telling you to add one first, rather than implying repositioning the circle would help.

### The Mapping → Lights control row no longer scrolls out of reach
- **Fixed:** scrolling down to reach the light index hid the Showcase/Automorph/Floor/Spacing controls above, with no way back to them but scrolling up — Garry: "the scroll hides the controls, needs fixing for mapping area." The control row now stays pinned to the top of the view while you scroll the map and index beneath it. The Lights sidebar card and Overview, which didn't have this problem, are unchanged.

---

## 0.38.27 — The door/window tool is now a circle you drag onto the opening (2026-09-09)

### Linking a door or window is now place-a-circle, not pick-a-wall
- **Rebuilt from scratch:** 0.38.26's "click the wall, then its two ends" picker turned out impossible to use in practice, and — worse — was never actually visible in normal use. An unlinked door/window row in Mapping → Lights now has a **Place** button. Click it, click the map once to drop a 1-metre circle, drag its body to position it and its rim handle to resize it, then **Done**. The two points where the circle crosses a wall become the edges of the opening; while you're positioning it, the wall segment inside the circle is drawn with a gap so it's obvious what you're about to cut. **Cancel**, or Esc, backs out at any point.
- The linking itself is unchanged underneath — same fabric fields, same open/closed indicator on the map either way.

### Every WLED card's IP address is now a link
- The control card for a WLED-class light shows its device's IP the same as before, but it's now a real link that opens the unit's own web UI in a new tab — one click to go deeper instead of a phone-typed address.

### The Lights builder's control row is easier to read
- The three Automorph sliders (Room %, Hardness, Subtlety) plus the style dropdown, and the Floor/Spacing/L-R view sliders, now each sit in their own faintly shaded group instead of one flat run of controls — each related set reads as one thing at a glance.
- The Automorph style dropdown now has a visible "Style" label, matching the sliders beside it.

---

## 0.38.26 — Link a door or window right from the Lights map (2026-09-09)

### Linking a door/window sensor no longer sends you to a different tab
- **Moved:** an unlinked door/window row in Mapping → Lights now has a **Link on map** button. Click it, then click the wall on the Lights map itself, then its two ends — the sensor is linked, right there. Previously the row's button ("Link in Rooms →") jumped to Mapping → Rooms → RF Barriers to do the same thing; found live: "no-one can see the thing you seem to think is there." The wall-splitting and linking underneath is unchanged — same fabric fields, same effect on the map either way — only the tool moved to where the trigger actually is: placing the sensor.
- While armed, every other unlinked wall on the current storey now shows faintly on the Lights map so there is something to click — a wall otherwise only ever shows there once it is already a linked door.
- Esc, or the row's own Cancel button, backs out cleanly at any point in the 3-click pick.

---

## 0.38.25 — Overview: walls stay on their own floor, and the coverage heatmap is a real heatmap (2026-09-09)

### Walls no longer bleed between floors
- **Fixed:** with Walls on, the Overview drew every wall within two storeys onto every nearby storey, at that storey's height — the upstairs walls across the main floor, and the main floor's across upstairs. Found live: "some of the walls are OK, maybe a floor to floor bleed?" — exactly it. Walls are still gathered across neighbouring storeys, because the coverage model needs the walls between a device and a scanner on another floor; they are now only *drawn* on the storey they belong to, the same rule scanner markers already followed. This dates from August and is unrelated to the door/window work.

### The coverage heatmap is now continuous
- **Rebuilt:** the storey heat was a 36×36 mosaic of hatch-filled cells in 16 colour steps, each cell a sparse dotted texture rotated to a different angle — which read as noise. It is now a continuous raster: the coverage model is sampled on a finer grid, smoothly interpolated to pixels, coloured on a continuous ramp, and placed as one image mapped exactly onto the slab and clipped to the rooms, so it no longer spills into the gaps between them. Walls read as real shadow steps and scanners as hot spots.
- **Same meaning, better ramp:** red is still poor and green still good, but the ramp is now interpolated in a perceptual colour space with lightness rising steadily from worst to best, so the picture reads by brightness alone as well as by hue.
- **A dBm legend** now sits in the overlay bar while Heat is on; its two ends follow the Gain and Contrast sliders.
- A browser that cannot encode an image falls back to the previous hatch drawing.

### Since 0.38.22 (the 0.38.23 and 0.38.24 pre-releases)
- **Door and window sensors on the map.** A `binary_sensor` with device class `door` or `window` is linked to a section of wall in Mapping → Rooms → RF Barriers (pick the wall, click its two ends, choose the sensor). Mapping → Lights and the Overview then show that section open or closed live, with a small marker at each end of the opening; a steel section (material *metal*) also stops attenuating the coverage model while it is open. Unlinked walls and installs with no door sensors are unchanged.
- Automorph aura fixes from the design critique; the motion legend shows every real colour sized to real durations; a "Hide device codes" toggle on Mapping → Lights.
- `recorder` is now declared in the manifest's `after_dependencies` (the recorder health check imports it); Hassfest had been failing on the repository since that check shipped.

---

## 0.38.22 — PadSpan Bright is ready for the HACS catalogue (2026-09-04)

- **A Bright release now waits for its Tests, HACS and Hassfest checks to pass before it is created.** That is the order HACS requires for a default-catalogue submission; a failed check stops Bright before the tag or release is published.
- **Bright's HACS links now stay with Bright.** Documentation and issue links point to `gbroeckling/padspanBright`, and its README has a one-click Add to HACS button, direct feature copy and no leftover internal or sales language.
- **The opt-in usage report now counts progress through the three guided setup tools.** It records which Mapping and Calibration wizard steps are reached, plus whether the Lights tour is finished or closed early. As with the rest of this report, it sends event counts only—never names, positions or the choices made inside a step.
- This is the stable release that will accompany Bright's submission to the default HACS integration catalogue.

---

## 0.38.21 — Every motion marker behaves the same way (2026-09-04)

### Motion + occupancy pairing no longer stretches one room's marker out of step with the rest
- **Fixed:** a device that reports both a `motion` and an `occupancy` binary_sensor from one physical unit (common on radar/mmWave hardware) rides the Lights map as a single merged marker — that part was correct — but its glow used to stay lit, and its recency ring used to keep resetting, for as long as *either* signal reported presence. A plain single-report PIR sensor only ever answers to its own signal. In practice this meant a house with a mix of hardware showed some motion markers pulsing far longer than others for no reason visible on the map. Found live: PadSpan's own G7TG and Living Room sensors were still glowing minutes after their own motion entities had cleared, held open by the paired occupancy half, while every other motion sensor in the house had already gone quiet.
- **The fix:** a merged marker now reads only its own motion entity's state and last-changed time. The occupancy half is still folded away — it never draws as a second marker — but it no longer extends the glow. Every motion-class marker on the map now looks and behaves the same way, whatever hardware sits behind it.

### Room labels and the motion-recency ring, corrected in 0.38.19, now in the changelog
- The 0.38.19 entry below didn't call these two out by name, though both shipped in that release: a room label's collision check against nearby markers now sizes its avoidance window to the label's own rendered width instead of a flat pixel count (a long room name like "Spare Bedroom Bath" could previously sit drawn through a marker that a short name would have correctly dodged); and the motion-recency ring's colour schedule was corrected to hold blue for the first five minutes, then sweep through the spectrum, reaching green at two hours and holding there until the ring disappears at six hours.

---

## 0.38.20 — PadSpan Bright goes live, and the manual sounds like PadSpan again (2026-09-04)

### PadSpan Bright is now its own HACS integration
- **PadSpan Bright now has a public repository of its own:** `gbroeckling/padspanBright`. It looks and installs like an independent HACS integration, but there is still only one source to maintain. Every PadSpan HA release builds the Bright tree from the same files, renames and checks it, runs its own test suite, and publishes the matching Bright release automatically.
- **Bright cannot drift away from PadSpan HA.** Its repository is generated during the release rather than copied by hand or kept in sync later. A failed Bright build is reported and is never quietly published.

### The manual says what the product does
- **Removed the sales copy and developer language** that had crept into yesterday's Bright manual and Help entries. Instructions now name the control, say what it does, and stop there.
- **Corrected four claims while rewriting them:** the sidebar Lights panel does not require a Pro key; correcting a wrongly detected light type is PadSpan Pro rather than Bright Pro; motion and temperature tiles are not switches, but motion still opens its seven-day history; and the motion-history ring now documents the real blue-to-green schedule used by the map.
- **Long explanations are split into useful pieces.** Showcase, Fit room, Isolux, Scene and Ripple each have their own short description, and the Bluetooth, scanner, backup, Pins, Roam, Insights and Health help no longer expose internal terms where the screen itself does not use them.

---

## 0.38.19 — Three guided wizards, and a help system fact-checked line by line (2026-09-04)

### Wizards for the three hardest parts of setup
- **A Setup Wizard for Mapping** — Upload → Set Scale → Draw Rooms → Place Scanners → Finish, one task per screen, embedding the real Upload and Edit tools rather than re-implementing them. A live "N of M rooms drawn" checklist against your actual Home Assistant areas replaces the old checklist's bare "go check that tab yourself." Reachable from Library's empty state, a persistent "+ Add a floor" button, and the Overview checklist itself, whose map-building rows now launch the wizard at the right step instead of just switching tabs.
- **A guided tour for the Lights builder** — a small "Guide me" card that highlights the real controls on the page in sequence (placement, shapes, WLED, Showcase), rather than taking over the screen the way the Mapping wizard does — the Lights builder is already one dense page, not scattered tabs. Tier-aware: free tier's last step is an honest note about what a key adds, instead of walking through a feature it doesn't have. Opens once on its own the first time you visit, same as the sidebar's existing coach mark.
- **A guided Calibration wizard** — Check scanner positions → Choose your device → Walk your home → Compute your model → Finish. Half of calibration is a physical task, so the wizard's job is sequencing and validation, not new UI: it embeds Roam's own live coverage heatmap and "next target" crosshair rather than reinventing guidance, and won't let you wander into Roam or Model before a device and floor are actually chosen.

All three share one rule with the checklist they replace: "is this step done" is asked exactly once and answered the same way everywhere it's asked — closing off the exact defect class that let Setup Progress flash "0/5, start over" at an established install in a past release.

### The help system, fact-checked against the live code
- Every one of the 44 in-app help entries was checked against the actual view source, not memory — 22 had drifted: removed features still documented, real features never mentioned, button labels that had changed (Receivers → Radios, Heatmap → Heat, Monitor → Advertisements), wrong tab names for where things actually live.
- Two help keys were silently dead — `settings_presence` and `maps_stack` were each defined twice, and JavaScript quietly keeps only the second definition. Two more (`zones`, `insights`) were referenced by the manual but never defined, rendering blank.
- The Bright Pro manual's motion-tile description was out of date (it still described the old read-only toast; a tap opens a 7-day activity history now) and never mentioned the Pro-only light-type-override tool — now documented, gated so Bright Pro customers aren't shown a feature they don't have.
- A new guard test fails the suite if a help key is ever defined twice or referenced without existing — the same protection this codebase already has for the light-shape vocabulary and the Bright edition map.

---

## 0.38.18 — Filter, sort, a manual, and a floor-selector bug that fooled a customer (2026-09-03)

### The light index gets filter and sort
- **Filter the index by device type** — a dropdown above the table narrows it to just Lights, Strips, Fans, Motion or Temps, always listing only the types your house actually has.
- **Sort by any column** — Code, Light, Room or State — with the standard three-click cycle: ascending, descending, back to the underlying order. State sorts a temperature reading numerically, not as a printed string.

### Motion and the code chip, corrected
- **A motion sensor's quick tap now opens a weekly activity calendar** instead of the read-only refusal — a 7-day × 24-hour grid, shaded by the hour, of when it actually tripped, pulled from Home Assistant's own history.
- **The light's code no longer has its own always-open shortcut.** Every point on a marker now goes through the same rule: a quick tap switches, and only a genuine 500ms hold opens the controls card.

### A real manual, in the Help tab
- **PadSpan Bright Pro finally has a manual**, reachable from Mapping → Help: getting a licence and turning on the sidebar Lights panel, everyday control, building your map, placing and arranging lights, what the view modes and colours mean, and 3D Stack/Export/Health. Every claim in it was checked against the actual code, not written from memory.

### Two bugs a customer actually hit
- **A temperature sensor could never be placed on the map.** Assigning it a room genuinely saved to Home Assistant, but a registry scan silently excluded `sensor.*` entities from the map's own room lookup, so the light could never cluster into a room or be placed at all.
- **GitHub #62 (rjbutler): an upload could silently land on the wrong floor.** The Mapping view re-renders on a five-second poll regardless of what you're doing, and a poll tick landing while the native file-browse dialog is open could rebuild the floor dropdown back to the first floor in the list before your real choice re-applied — and the Upload button trusted whatever the dropdown showed, not what you'd actually chosen. It now trusts the recorded choice instead, the same way the dropdown's own display already did.

### Smaller things
- Rooms now carry a soft centre-glow like the light pools do, dialled down — the same shaded look, less intense.
- The builder's toolbar buttons are grouped with dividers — mode toggles, history, view, info — so a busy row scans faster. Nothing moved, hid, or changed what it does.
- The sidebar's coach-mark and hint text now say plainly that motion and temperature tiles are read-only, and the builder's hint mentions the locate-ring and drop-marker ways to find and place a light.

## 0.38.17 — Temperature sensors, and a smarter idea of "the same sensor" (2026-09-03)

### Temperature sensors join the ceiling map
- **A temperature sensor is a placeable device now**, the same as a light, fan or motion sensor — its own T-series code, a thermometer glyph, placed in metres like everything else. When it has reported within the last hour *and* it has actually been placed, its marker shows the reading itself — large, in place of the code — instead of making you hover or open anything to see it. A stale reading or an unplaced sensor falls back to the ordinary small code, exactly like every other shape does when it has nothing special to say.

### Motion and occupancy sensors from the same physical unit merge into one marker
- A single mmWave/radar sensor commonly reports two separate entities for the same spot — a momentary "motion" reading and a sustained "occupancy" reading that survives the stillness a motion algorithm's own timeout would clear. These now merge into one marker: it stays active while *either* half says someone's there, and its recency glow uses whichever half moved most recently. The merge only happens when a device reports exactly one of each *and* the two entities' names agree — a multi-zone hub (an alarm panel's expander module, say) sharing one device ID across several physically different rooms is never mistaken for a single sensor.

### Finding and placing a light, two more ways
- **Choose a light from the Mapping → Lights index and a slow ring flashes outward from wherever it actually is** — a third of the whole map across — so a small marker in a big house doesn't take a hunt to find.
- **A drag-and-drop pin, parked in the corner of the map**, is a second way to place whichever light is selected — drag it from its corner onto the spot, instead of hunting for the light's own marker first.

## 0.38.16 — Fans, motion sensors, and a map that finally works like a map (2026-09-03)

### Fans and motion sensors join the ceiling
- **A fan is a first-class device on the map now**, not a decorative glyph on a light. `fan.*` entities get their own F-series code, glyph and border, and place in metres exactly like a light. A hold opens a control card set up the same way WLED's is: speed, preset, oscillate, direction — each offered only when the entity actually has it.
- **Motion sensors join the list of placeable devices.** A triggered sensor pulses blue beneath its marker, in both the working map and Showcase, and is read-only to a tap — its job on the map is the pulse, not a switch. Admitted by device class, not domain: HA has two distinct PIR presence classes, `motion` (momentary) and `occupancy` (sustained — an outlet-integrated bathroom sensor reports this one), and the map now recognises both as the same thing a household actually means by "is anyone in there".
- **A quiet sensor still says how long ago.** For six hours after it stops tripping, a calmer ring keeps glowing at its last spot, its colour sweeping almost the whole spectrum from blue the instant it goes quiet to violet at the six-hour mark — a rainbow of recency, not a status you have to go check the history for. Past six hours, nothing.
- **A Pro-only override** in the Mapping → Lights index lets the household's own word beat detection when PadSpan gets a light's class wrong — force it to WLED, partition, or plain. Bright ignores the stored override entirely (detection rules there), which is what makes it a Pro feature.
- The room-perimeter/cove trace's crisp line now wears the same outline convention every other marker does (blue working, white lit, slate off, strip borders) instead of the fixture's own colour — the glow underneath still carries that.

### Control-from-the-map, redesigned around how a hand actually taps a screen
- **A press-and-hold is no longer the only way to reach a light's controls.** Its short code is now its own target — tap it (or hold the light, still) to open brightness, colour, effects or fan speed; tap the light itself and it just switches. A ring fills under a hold before it opens, so the gesture is visible instead of a guess.
- **Tap a room's name, or a floor's badge, for everything there at once** — a sheet lists every device with an All-off/All-on pair, lights and fans counted separately so "all off" never silently takes the fan with it, motion shown as status rather than a switch.
- **A pile of unplaced devices in one room collapses to a single "N unplaced" chip** instead of a stack of overlapping markers fighting for the same tap.
- **Layer chips** — Lights, Strips, Fans, Motion — dim every other class instead of hiding it, so context stays on the map while you work one kind of device at a time. Floor chips remember each storey's own zoom and scroll position and carry a live activity dot.
- **Pinch to zoom, one finger to pan** — a real touch gesture pipeline on the map for the first time.
- A tap flips a marker immediately and reverts with a shake if the light doesn't actually answer, instead of waiting on the round-trip in silence.

### The builder gets the tools a floor plan actually needs
- **An unmistakable "Editing" badge** and a drafting-grid backdrop while the Mapping tab is open, plus a one-tap **Preview as sidebar** that shows exactly what the household will see without leaving the builder.
- **Queue several lights, then tap the map once per light** to place a whole room without dragging each one out of a pile by hand — or use **Spread in room** to lay every unplaced light in a room on an even grid inside its own walls in one move.
- **Multi-select, undo/redo, arrow-key nudges, and copy-appearance-to-selection** — the ordinary toolkit of a layout editor, now on the lights map.

## 0.38.13 — The lights map learns to draw light (2026-09-02)

### Showcase renders light the way light behaves
- **White bulbs pool warm or cool, as they actually are.** A colour-temperature-only bulb has no `rgb_color`, and its pool fell back to a flat default amber. It now tints from the bulb's own Kelvin (Tanner-Helland blackbody), so 2700K reads as a living room and 5000K as a workshop.
- **Light stops at the walls.** Each fixture's pool is clipped to its own room's polygon — resolved from its position by the same ray-cast the room-fit cap uses — with a soft feathered edge past the boundary, like a doorway leak. Where a pool actually reaches a wall, a faint stroke of the pool's own colour runs along it.
- **Beam shape is a property of the fixture type.** A spot throws a tighter pool, ahead of the glyph along its aim; a sconce washes forward off its wall; a chandelier spreads wider; an indicator LED barely pools.
- **Pools breathe** — a slow, staggered sway, amplitude riding brightness, so the house never pulses in lockstep.
- **Day and night**: the ground lifts and pools mute as the real sun rises (from `sun.sun`), and the night render is exactly what it always was.
- **Spatial scenes**: a scene is a colour field across the floor, not a colour list — every lit fixture previews the field's colour at its own metres, and Apply sends exactly the previewed colours. Preview and apply share one sampler, so the map cannot promise a colour the lights don't get. Sunset, Dusk, Ember, Ocean; rotate the axis in 45° steps.
- **Ripple**: arm it, tap the map, and a brightness pulse rolls outward through the house in real-distance order. Only lights already on take part.
- **Isolux** (☼): relative-illuminance contours on a real-metre grid from the fixtures' real positions and brightness — three bands at fractions of the floor's own peak.

### A tap is the light switch again
- Tapping any effect-capable light used to open its control popup, which made the most capable lights the only ones you couldn't simply switch from the map. A tap now always toggles — the device's own last settings rule — and the popup moved to a half-second hold, on the map and in the index table alike.

### ESPHome partition strips get the WLED treatment
- A `light.partition` entity — one addressable strip split into segments by LED range — is recognised from the entity registry (most partitions configure no effects, so the effect-list test WLED uses would miss them entirely). P-series codes beside WLED's W-series, a blue border beside WLED's purple, the same strip glyph, the same hold-for-controls popup. A segment that also carries effects reads as WLED-class — the more capable identity wins.

### A new fixture shape: room perimeter / cove
- Traces the actual room polygon the light sits in — placed or still auto-clustered — inset by an adjustable margin, structurally unlike every other shape (those are an icon at a point; this is the room's own boundary, drawn from the fabric's metres). Dimmer when off, never invisible; in Showcase the trace glows like the cove run it represents, and only its code and click space remain at the drop point — the trace *is* the fixture's body.
- The default margin is scale-aware: a fixed real-world inset is a clear line in a small flat and an invisible sliver on a spread-out house, so the default targets a fixed on-screen gap instead, capped at 30cm — no real cove sits further off a wall.
- The offset survives real rooms: hand-traced polygons close with near-coincident vertices (centimetres apart) and carry near-straight kinks — both now collapse or bevel instead of drawing phantom tails and spiked corners. Every one of these behaviours is pinned by tests built from a real house's actual room coordinates, not synthetic rectangles — because the synthetic ones passed while the real ones failed.

### Smaller fixes
- Room names on the lights map sit smaller and closer to their room's edge.
- The Mapping → Upload floor selector survives a rebuild mid-upload (a reconnect while browsing for a file silently reset it to the first floor — the file survived, the floor choice didn't; both do now). *(Shipped early as 0.38.12.)*

## 0.38.11 / 0.38.12 — stable promotions (2026-09-02)
- 0.38.11 promoted 0.38.10 to the stable channel. 0.38.12 added the upload floor-selector fix above.

## 0.38.10 — The trace follows its picture (2026-09-01)

### An image edit takes the hand trace along, unconditionally
- **A map carries two kinds of fractional data, and one flag was covering both.** Receivers and beacons are fabric-anchored — their truth is metres, their fractions a rendering, re-derived after any image op. The room trace is image-anchored — its only truth is "these fractions of this picture" — and there is nothing to re-derive it from. `skip_frac_renorm` skipped it anyway, so **every trim of a measured map left the trace in an image space that no longer existed** (issue #62, third act: rjbutler's basement and upstairs previews drew every room at ~55% of the photo's width — stale full-image fractions on a cropped image). The trace now renormalizes with every image edit — trims through the crop rectangle, baked rotates/scales through the same centred affine the placement composition uses, with the same precedence between them — and no flag reaches it. Verified end to end: a test runs both real code paths on a world-rotated map and demands every trace point land on the same square metre of house before and after.
- **A stamp now names the picture it was made against.** A placement snapshot alone cannot tell a re-measure (trace still valid) from an image op the trace might have missed — both rewrite the same six fields. The image's identity settles it: the reconcile honours a stamp only while the map still shows that picture, unless the recompute converges on what is already stored — which is the signature of a completed image op, and reconciles as a harmless restamp.
- **When a floor's two room records drift apart as a group, Health now says so.** The committed fabric and the map's trace describe the same rooms two ways; when either predates a change to the map, every shared room drifts by the same factor — and no human edits every room by an identical amount. The detector names the map and the factor, deliberately does not guess which side is stale, and points at the comparison that answers it in seconds: both layouts over the photo. The usage report counts affected maps.

### Five more coordinate bugs, found chasing the above
- **Migrating a circle between maps computed its radius from already-transformed values** — wrong whenever the two placements differ, which is the only time a migration runs. It now probes from the source record.
- **"Revert migration" computed its cleanup and never saved it** — the button reverted the canvas extension and left every migrated item behind, clamped flat against the restored border. It now strips first, then un-extends.
- **Restore-from-backup silently dropped the room trace and receiver pins** it had faithfully exported. A restore now brings back everything the backup holds.
- **An extend snapshot survived later image edits**, so a revert after an intervening trim cropped the wrong rectangle out of the wrong image. Replacing the image now invalidates it.
- **A tab left open across an image edit could push old-space geometry back over the server's corrected copy** — the Edit-tab draft now lives exactly as long as the picture it was traced against (keyed on the image's identity), and the Manage-tab orphan cleanup rebuilds its payloads from a fresh fetch, never the tab's copy.

## 0.38.9 — Rooms remember the placement they were built from; the occupancy number is people (2026-09-01)

### A map fixed after its rooms were built no longer leaves them silently wrong
- **Rooms are adopted from a photo once and never re-derived** — that is what makes hand corrections safe, and it is also how issue #62's Main Floor stayed 10.7 m wide in a house measured at 18.35 m: the map's placement was corrected *after* its rooms were built, and nothing ever pointed back at them. Health now compares each floor's rooms against the largest measured map on that floor — per axis, because the real fault was one axis at 58% of the map with the other at 90%, and a single blended number hides exactly that — and names the floor. The usage report carries the count.
- **Committing an untouched "Map placements" room now records the claim that commit makes**: which map, and that map's placement at that moment. Any hand correction clears the record — a corrected room makes no claim, so nothing automated can ever mistake it for one that does. A room whose recorded placement no longer matches its map appears in Mapping → Rooms with one button — **Update from map** — which re-derives those rooms through the same arithmetic the preview draws, reports every room by name, and structurally cannot reach a room you have ever shaped by hand.
- **This is the one sanctioned map→fabric write since the fabric existed**, and it is shaped by the incident that created the rule it loosens (the old automatic rederive corrupted hand-traced work through drifting transforms, as a side effect, silently): explicit action only, never a side effect of another save; the photo trace is read, never written; every failure is reported, none swallowed.

### The occupancy number is people, not devices

### What was wrong
- **The big number on the Overview was a count of tagged things.** "7 identified" was a key fob, a test beacon, one truck beacon counted twice, a closet beacon, a box — and one phone. Two people were home. Every labelled object, every iBeacon with a label and every HA entity the collector accepted counted as one person; "3 persons home" was two person entities driving off the same phone plus one more; the "unidentified" devices it added were a Windows PC's non-rotating address and an AirTag-class Find My tag. The one phone on the air that *was* a person — an unlabelled iPhone — never became an object at all, because rotating addresses are dropped before the estimator sees them. Training could only ever raise the divisor on the unidentified term, so recording the real count made nothing better.

### What it is now
- **Known people** come from HA `person` entities that are home, one per device tracker. A PadSpan object labelled with the phone's name (or linked to its tracker) places that person in a room; it never counts on its own.
- **Unclaimed phones and watches** are recognised on the air, not from objects: a rotating (resolvable private) address whose advert is what a phone or watch in a pocket sends — Apple Nearby Info / Handoff / Hotspot and the like, or a wearable maker — heard at −75 dBm or better by two or more scanners, with no local name. The locally-administered bit is not consulted (it is a random bit inside a rotating address, so the old test rejected half of all real phones). Phones in one room are one person: a phone and its watch, or a phone across an address rotation. A known person placed in that room owns them; a known person who is home but not placed is assumed to be them; only what is left is an unknown person, and that is counted.
- **Occupancy and presence sensors** are read by `device_class` and their HA area — not by words in the entity id — indoors only (the driveway radar in area "Outside" is not a room). They are a floor: every occupied room needs a body, and the bodies are the people already counted, wherever a weak beacon placed them. An occupied room with nobody placed in it raises the possible range, not the count, unless nobody is known at all. (The first cut added a person per occupied room and said 4 with 2 home — one lingering mmWave and one weak beacon away from the old mistake.) Motion places people and floors an otherwise empty count; motion that cleared within two minutes still counts; motion held on for over an hour is a stuck input and is named as such.
- **Tagged things are listed, never counted**, and the same physical thing with two addresses is listed once.
- **The range is honest**: the low end is known people plus phones nobody can explain; the high end adds every occupied room nobody is placed in. Confidence is high only when everyone counted is placed by a device and nothing is unexplained.

### The card and the tab
- The Overview card is titled **People in building**, shows the number with its unit, a range pill only when the range is real, who is counted and where, and one line of what was weighed — no more "7 identified · 3 BLE clusters · 3 persons home" that read like a sum and was not one. It shares the top row through the responsive `grid-2` so it stacks on a phone, and says "Unavailable" with the reason instead of leaving an ellipsis when the call fails.
- The modal and the Occupancy tab show Counted (who, where, how), Rooms with evidence, How the number was reached, and Seen — not people. The tab no longer reads keys the backend never sent ("multiplier undefinedx", "Total BLE 0", a history of "?"); recording a headcount stores it beside what the estimate said.
- `sensor.padspan_occupancy` keeps `minimum` / `maximum` / `confidence` and now carries `known`, `unknown`, `people` and per-room evidence instead of the multiplier and device counts. Pure Live's ticker says "tracked", not "people", for its labelled-object count.
- Tests: `tests/test_occupancy_people.py` builds the house as it was that day and requires 2; `tests/js/occupancy_people.mjs` runs the card, the modal and the tab against the estimator's real payload and fails on any "undefined".

---

## 0.38.8 — The 3D map uses the screen it is given (2026-08-26)

### The map fills the panel instead of sitting in the middle of it
- **The map was leaving about 30% of the panel blank down the sides**, and it was two separate margins stacking: the drawing's own frame padding, and the container's. Both were fixed sizes measured against a drawing whose width depends on your house — invisible on a large layout, a third of the screen on a compact one. That is also why this looked like a screen problem when it was really a *layout* problem. Both are proportional now, and the map fills roughly **93%** of the panel rather than 70%.
- **This is why beacons looked oversized.** A map that only fills two-thirds of the screen gets browser-zoomed to fill it — and zooming in makes map labels and markers grow *relative* to the map, because the map is already sized to the full width. The blank sides were the cause; the large beacons were the symptom. With the space reclaimed, less zoom is needed and markers sit closer to the size they were drawn for.
- **Beacon markers are also 30% smaller** in their own right — every part of one, from the rings to the name plate to the text, so the marker still looks like itself.

### If you want them different
All three are single numbers at the top of their section in the map view, and nothing else on the map depends on them: the beacon size, the frame padding, and the side margin. Adjust and reload.

---

## 0.38.7 — Beacon labels stop crowding the map on small screens (2026-08-25)

### Fixed
- **A beacon's name plate no longer takes a quarter of the width on a small screen.** The plate was capped at a fixed size while the map it sits on is not: on a compact layout it worked out at roughly a quarter of the drawing, and because map labels are deliberately held at a constant on-screen size, that is a quarter of your panel too. Invisible on a wide monitor, dominating on a small one — which is why it looked fine most of the time. The plate is now a share of the map, and long names are shortened to fit rather than the text being shrunk: a name you can read beats a full name you cannot. Hover and the objects list still show the whole thing.
- **Map labels re-scale while the panel is being resized**, instead of only after. The scale factor was fixed when the map was drawn and recomputed only on a full rebuild, which was itself gated behind a 4% width change — so a smaller resize never corrected the text at all, and dragging a window left labels the wrong size until the threshold tripped.
- The landing page now carries a v0.38.6 entry, including the two things from that release a reader has to be told rather than shown: the setup card that briefly flashed at established installs, and where BLE scan mode actually comes from since Home Assistant 2026.6.

### If you read "passive" on a proxy whose YAML says active
That is the one worth repeating. Home Assistant 2026.6 made *auto* the default scanning mode for every ESPHome Bluetooth proxy, and it overrides the device's own configuration. Reflashing the device cannot change it. The setting that decides is per device, in Home Assistant: **Settings → Devices & Services → ESPHome → *your device* → Configure → Bluetooth scanning mode**.

---

## 0.38.6 — A radio that is transmitting says so (2026-08-25)

### Fixed
- **An established install is no longer told it has not started.** v0.38.5 flashed "Setup Progress — 0/5 — Upload Floor Plan" at settled installs on every panel open. Nothing was wrong with them: the check read the map list before it had been fetched, and an empty list was mistaken for an unfinished setup. It mattered most on exactly this release — 0.38.5 is the one that rewrote how every map stores its position, so being told you had never uploaded a floor plan invited the conclusion that the upgrade had eaten your setup, and a backup restore to fix a problem that did not exist. The distinction that had to be right: **an empty list is an answer, an unfetched one is not.** A genuinely new install is still onboarded the moment the fetches settle.
- **The landing page had been rewriting its own release history.** The "What's new" entry for v0.37.0 was marked as the current-version claim — correct on the day it was written, when it was the newest entry — so every deploy restamped it. The live page ended up headed "v0.38.5 · Stable · 23 August 2026" over the text describing v0.37.0. A dated release entry is a statement about a past release, and nothing may stamp it now.

### Radios say whether they are transmitting
- **The inner ring of a radio's map marker turns red and blinks while that radio is actively scanning** — sending scan requests and reading the replies — and is unchanged while it only listens. Both the 3D house view and the flat map draw it, and the hover text names the mode.
- The blink is a plain SVG animation with no timer behind it, and the marker is only redrawn when its state actually changes, so a radio that has been active for an hour is still mid-blink rather than restarting every few seconds.
- **Only a confirmed "active" is drawn.** A radio set to *auto* is promoted for a few seconds at a time and is neither one thing nor the other; a radio that does not report its mode is unknown. Neither is coloured, because **not transmitting and not saying are different facts**.

### Where your radios' scan mode actually comes from, which is not where you would think
- Home Assistant 2026.6 changed the default scanning mode for every ESPHome Bluetooth proxy from active to *auto*, and it overrides what the device's own firmware config asks for. If your ESPHome YAML says `active: true` and PadSpan shows passive, **the YAML is not what decides any more** — editing and reflashing it cannot change this.
- The setting that does decide is per device, in Home Assistant: **Settings → Devices & Services → ESPHome → *your device* → Configure → Bluetooth scanning mode**. Set it to Active and Home Assistant pins it and stops downgrading. There is no fleet-wide switch.
- Worth knowing before changing anything: active scanning means the radio transmits, which costs 2.4 GHz airtime you may be sharing with Wi-Fi. Auto exists because it is a reasonable default, not because it is broken.

### Counted in the usage report, if you have opted in
- How many of your radios are in each scan mode, and how many were *asked* to be — two different numbers, and the difference is the whole point: on the install this was built against, **nothing** was set to passive, yet seventeen radios read passive, because that is what auto does between promotions.
- Also whether a radio's mode ever changes, counted separately for auto and for pinned radios. A pinned radio should never change; if pinned radios turn out to change on other people's systems, the indicator above does not mean there what it means here — and that cannot be learned from one house. Counts only, as ever, and Preview still shows exactly what would be sent.
- Overview and the Bluetooth view show your own split; the developer install-base view shows the fleet's, including how many people deliberately pinned a mode.

### Also
- **A marketing animation rendered from the data rather than screen-recorded.** Eight real hours of one house in 36 seconds: three storeys stacked isometrically, six devices that actually change rooms, each dragging a fading trail, wall clock in the corner. No cursor, no window chrome, reproducible from a script. A floor change is drawn as a cut rather than a path, because it is not one.

---

## 0.38.5 — The card that announces an update broke the tab it appeared on (2026-08-25)

### Fixed
- **The Overview tab went blank on the first install that qualified to see the what's-new card.** If you updated from 0.38.0 to 0.38.1, Overview stopped rendering. Nothing was lost and nothing was written wrong — the tab simply threw on the way to drawing, and Home Assistant showed an empty panel with a clean console. Update to 0.38.2 and it returns, card and all.
- The cause was one undeclared name. `_whatsNewCard` referenced `notesUrl`, which had been declared nowhere since the refactor that removed a top-level `await import()` from `panel.js` and left the use site behind. JavaScript raises `ReferenceError` only when control actually reaches the line, and control could not reach it until an install had a *previous* version recorded — so on every install in existence the method returned early and the defect was invisible. 0.38.1 was the first release where anyone could satisfy `seen && seen !== APP_VERSION`, and they lost the tab for it.
- **The same card could have been killed a second way**, and that is fixed in the same release: `proPitch` was called without a guard. Three lines above it sits an import of `editions.js` that is *deliberately* allowed to fail, with a comment saying a failure there must not take the panel down. The call site did not honour that contract, so a throw inside that module would have cost the tab by another route. It does now.

### If you are coming from 0.37.x, read this one paragraph
- This release carries **0.38.0's placement conversion**: a map's position now lives once, in metres, and the old duplicate copy is deleted. PadSpan takes an **automatic snapshot before the first step that writes** and refuses to convert at all if that snapshot cannot be taken — no snapshot, no conversion. Ordinary upgrades need no action; `sigma = 0` was verified bit-for-bit against the old arithmetic, zero differing doubles across 53,900 comparisons each way in both Python and JavaScript, so nothing moves.
- **If something does look wrong, restore that snapshot from inside PadSpan** — Health → Backup/Restore, the entry named for this upgrade. Do **not** roll back in HACS: the stores carry no downgrade path, so an older version silently reads the converted files and you would lose the snapshot's usefulness along with it.

### Why the suite did not catch it, and what changed so the next one is caught
- `node --check` parses a file; it does not execute it, and an undeclared identifier is legal until reached. The suite was green with the defect in place — verified by putting the defect back and watching 1298 tests pass.
- `tests/js/render_smoke.mjs` was built for exactly this failure and its own header lists four earlier instances of it. But it walks `views/`, and these cards live in `panel.js`, which had no such net beneath it. That was the gap, not the identifier.
- `tests/js/whats_new_card.mjs` now *runs* the card against the module-level names `panel.js` actually provides — `el`, `APP_VERSION`, `EDITIONS` — and nothing besides, in each of the six states that gate it: no stored version, first sight, a real update, the same version, `editions.js` unavailable, and `proPitch` throwing. A card that reaches for anything outside that set throws in the harness instead of in somebody's browser. Confirmed by reintroducing the original defect: `node --check` still passed, the harness failed.

---

## 0.38.1 — An update says what it changed, and the paid half stops being a secret (2026-08-25)

### What's new, once per version
- **A card on Overview after an update**, naming the version you came from and linking the release notes. An update lands silently: Home Assistant's persistent notification is easy to miss and easy to dismiss unread, and the notes live somewhere the reader is not — so a release that fixes the thing somebody complained about goes unnoticed by the person who complained.
- **It seeds rather than shows the first time it sees an install.** With no stored version there is no way to separate a genuine update from a first-ever install, and telling somebody who has just installed PadSpan that it "updated" is worse than saying nothing. First sight records the version quietly; the card appears only on a real change. `whatsnew_seen_version` holds it, and only a version-shaped string is stored — the panel writes it from its own build constant, so anything else is a bug or a probe.
- The notes link is the same page the update-check manifest points at, defined once, so the notification and the card cannot disagree about where the notes are.

### The two paid features stop being a secret
- Until now the only place Forensics and light placement were named was a **refusal you hit by trying to use them**. The card mentions them once per release, in one line — and only to somebody it could be news to. **A PadSpan Pro customer is never pitched PadSpan Pro**; a Bright Pro key is told about Forensics and never sold the light placement it already owns; a lapsed licence is told its work is still there and still exportable, rather than being sold to.
- The rule is a pure function rather than a branch buried in the card, so it is tested directly: `tests/js/pro_pitch.mjs` runs 26 checks over it, including that an unknown or missing tier falls back to the free wording — the safe side is telling somebody about a feature, never hiding one they paid for.

### PadSpan Bright Pro can be bought
- The lighting half is now a licence you can actually buy, and **PadSpan Pro still includes everything it does** — they are not alternatives, and there is never a reason to hold both. A key bought for lighting unlocks light placement inside PadSpan HA today.
- Nothing in the integration changed to allow it beyond the tier already in the ladder: the licence server now reports which tier it sold, and a key issued before that existed still resolves to Pro, exactly as `licence.py` has always promised.

### Fixed
- **A near miss, recorded because it nearly shipped.** The card's notes URL was first imported with a top-level `await` in `panel.js`. Three lines above sits a comment saying a failure loading that module must not take the panel down — it falls back to showing everything. A top-level await turns that survivable failure into a blank panel for every user. The URL is read at render time now, and a test pins the rule for the whole file.

---

## 0.38.0 — A map's placement lives once, in metres (2026-08-25)

Four bugs — the pre-0.36 trim, #64's stale affine after Change Master, #62's wrong-aspect solve, and #67's dropped master flag — were never four bugs. A placement was written down **three times**: the stack's raw affine, the decomposition stored beside it, and the metric record. Every one of those failures was two of the three disagreeing, and `stack_desync` existed only because the design permitted it. This release deletes two of the copies. **2,455 lines go with them.**

### The record carries the whole placement
- **A sixth degree of freedom.** `metres = origin + R(ρ)·[[Sx, −Sy·sin σ], [0, Sy·cos σ]]·frac`, σ ∈ (−π, π]. **σ = 0 is the old five-field arithmetic exactly** — verified bit-for-bit, zero differing IEEE-754 doubles across 53,900 comparisons in each direction, in Python and in JavaScript — so nothing moves on upgrade. σ = ±π *is* a mirror, so reflection is not a separate flag. Six fields reproduce every affine the renderer can draw to **1.9e-14 m**; five miss by up to 54 m. `shear_rad` had in fact been written to disk since the photo-divorce migration and read by nothing.
- **One writer.** `_put_map_transform` carries forward any placement field a payload does not *state*, so a five-field rebuild is structurally impossible. The same rule now governs the stack and `reference_measurements` — an absent key no longer deletes the field that decides whether a map counts as measured.
- **`stack_from_transform` derives the rotation** instead of reading it off the stack it is repairing. Against an empty stack that was wrong by 5.70 m at 7° and 93.30 m at 180°.

### The world gauge is stored, not measured off a photograph
- `find_metre_anchor` divided a measured width by a footprint read from the stack — and the stack is now derived from the record. **One stored isotropic scalar** replaces it. The anchor used to be the *first* qualifying map in the list, so the house's metre scale depended on array order: two self-consistent maps measured at different scales swung it **20%**, placing the same map 5.000 m differently. Gone.
- `iso_error`, `degraded`, the candidate loop and the JavaScript twin are deleted. **Issue #62 is now unrepresentable rather than fixed** — metres carry no aspect ratio, so there is no pair of axis scales left to disagree.
- Two live bugs died with it: the calibration and traceback views applied the x scale to y, drawing an object 10.000 m out of place on a trimmed anchor.

### The stack is derived on read
- Stored state shrinks to what is genuinely not placement — `z_level`, `ceiling_height_m`, `tie_ins`, `ref_map_id`. `tie_ins` are re-expressed in metres. `_recrop_stack`, `async_derive_transforms`, `changeMasterStacks`, `worldAffine` and its decompose/recompose pair, both repair commands, `maps_affine` and `stack_desync` are gone.
- **`is_master` is deleted.** Room-merge precedence gets an order that cannot be nulled, and the align-onto-master refusal deletes along with the flag it was guarding — a guard is not a fix.
- **The conversion**: it snapshots every store it can touch *before the first step that writes*, records a per-map marker as it goes so a mid-run failure is not re-run, refuses to proceed without a gauge, and reports per-map corner displacement. Where the two descriptions disagree, a **measured** record wins and an unmeasured one yields to the alignment the owner applied.

### One agreement test, not five
- Whether two placements agree was decided in five places, each comparing four terms of six, and none comparing rotation. On a 20×15 m map with an identical origin and identical scales, a ±5° lean read as agreeing at **2.61 m** apart, a 45° lean at 11.48 m, a 30° rotation difference at 12.94 m, a half-turn at **50.00 m** — panel tick shown, Repair Positioning skipping the map, Rebuild Stack refusing it. All three repair routes closed on a map that was metres wrong.
- There is now one definition — the greatest distance in metres between where two placements put the same corner of the picture — used everywhere, alongside the component tests rather than instead of them. A fault names the terms that fired, so the Health critic and the usage report cannot drift from the gate that raised it.
- Where the evidence is a size disagreement, neither half can be shown to be the stale one, so the panel offers **both** repairs instead of guessing.

### Also fixed
- A migration step marked itself done whether or not it ran. `LIGHTS_TO_METRES` was already silently broken by this — marked complete with no anchor, lights never converted, on precisely the installs that upgrade before measuring a map.
- `ws_fabric_map_transform_set` had no admin check, unlike its three sibling handlers; a payload omitting `floor_id` silently moved the record to the main floor.
- Restoring a JSON backup matched maps by **name**, so a restore wrote the backup's alignment onto a pre-existing same-named map.
- A record that could not be read at all reported as *aligned*, and the one diagnostic written to find broken records skipped exactly them.

---

## 0.37.1 — Point Align stops handing a map the wrong picture's proportions (#62) (2026-08-24)

### The rigid solve used one aspect ratio for two different pictures
- **A map point-aligned onto a differently-shaped map came out squashed by exactly the ratio between them.** `_solvePtAlignRigid` was handed a single aspect ratio — the **reference** image's — and used it for both images, converting the target's fractional coordinates into square-pixel space with the reference's ratio. The matrix it reconstructed therefore always had `m11 == m22`, and since the renderer stretches every y term by `_m_ar`, a rigidly point-aligned map's world footprint was pinned to the reference's shape whatever its own picture looked like. A 1600x853 floor aligned onto a 930x850 one landed at `1 - 0.5331/0.9140 = 0.4167` iso error, 33% short across, and 1.71x squashed — the health card's three lines, all one dropped term. The solver now takes the target's own aspect and puts it on the target's terms: "rigid" means uniform in the *target's* pixels, which is what it always meant. Where the two pictures already agree the output is bit-identical, so no working alignment moves.
- **The invariant, written down where it broke:** a map's world footprint carries its own image's aspect, so world pixels stay square. Audited against every other placement writer — the 6-DOF solve, the drag path (which already computed this exact factor as `scale_x_adj`, and was the tell), `changeMasterStacks` and `_recrop_stack` were all clean. The rigid solver was the only one that broke it, and it is the default.
- A missing or non-positive target aspect is refused outright rather than falling back to the reference's, which would have re-enabled the bug for any future caller.
- Verified under node from pytest (`tests/test_point_align_solver.py` → `tests/js/point_align_solver.mjs`, 79 checks: footprint aspect at four rotations in both directions, planted size, offsets, residual, bit-identity with the one-ratio model where the shapes agree, and matrix/decomposition agreement). Confirmed as cover by mutation: reverting the solver fails 36 checks, and of 15,000 generated solver variants exactly four pass — all four bit-identical rewrites of the shipped one.

### And the maps it already bent repair through the button that was refusing them
- **`stack_from_transform` refused every solved-affine stack** — which is precisely the shape this bug writes, so **Rebuild alignment** could not reach the one map it was built for. It now rebuilds the state the bug creates, identified by that state's own signature: world columns that are not in the map's own picture's ratio. Everything else is still refused, so a deliberate alignment cannot be snapped back onto its metric record by a fault that was only ever an origin nudge. The rebuilt stack drops `_m`/`_m_ar` with it, or `stack_world_xform` would go on drawing the stale matrix.
- **Nothing runs at load and no stored map changes until someone presses the button.** There is no migration.
- The websocket refusal string and the Rebuild confirm text had both stopped being true, and now name both reasons.

---

## 0.37.0 — Stable: Change Master moves the whole house, and the release tells the install base it happened (2026-08-23)

The first stable since 0.35.0. Everything from 0.36.0–0.36.9 is in it — the trim skew fix (#62's write and read sides), the 0.36.2 outage fix and per-object isolation, the phantom-device and solver-certainty fixes, the scanner-name resolver (#65), the telemetry fields of #66, the opt-in ask, and the Install Base view — plus the items below. If you are on 0.35.0, the Mapping sub-tab throw fixed in 0.36.0 is reason enough on its own.

### Change Master relinks on the matrix — the whole of it this time (#64 step 3)
- **Every map moves into the new master's frame, and the arithmetic is the renderer's.** The relink composed a map's new placement out of `x_offset` / `scale` / `rotation` — the inputs to ONE of the renderer's two branches, ignored entirely for a map whose placement is a Point-Align matrix — and then only for maps whose `ref_map_id` was the old master, leaving every other map behind in the old world frame. A stack is an absolute placement; nothing reads `ref_map_id` for geometry. Now the whole house is re-based in one exact step on the world affine each stack actually draws: `S ∘ B⁻¹ ∘ P` for every map, the new master landing at the pristine origin by construction, hand-placed and Point-Aligned maps treated identically, and every result written with the matrix *and* the decomposition that agrees with it — so a swap can no longer manufacture the `stack_desync` state it used to.
- **One algebra, shared.** The stack→affine read, compose, invert, and affine→stack write live in `stack_transform.js` beside `makeStackXform`, and the Point Align apply path now goes through the same functions instead of carrying its own copy of the branch logic. The wizard and Training text now describe the exact relink rather than warning about the drift the old one caused.
- Verified under node from pytest (`tests/test_change_master.py` → `tests/js/change_master.mjs`, 50 checks: pristine origin, rigid motion of stale-field and matrix maps alike, matrix/decomposition agreement, round-trip to the starting placement, refusal of a singular master). Confirmed as cover by mutation: a reader that ignores `_m` fails 17 checks; a relink that skips maps not referencing the old master fails 10.

### The usage report stops carrying fiction
- **`positioned_now` and `outside_now` were always 0 by construction.** Both read the cached snapshot, and both facts are attached per-request inside `ws_live_snapshot` — the cache never carries them. They now read the coordinator's own poll result (the same dict the live view overlays), gated on `is_identified_object` — the engine's one test for "someone's device", now also used by the adaptive-learning gate it was copied from — so the count is of the house, not of every phone that drove past.
- **`calibration_auto_points` was always 0** — it looked for a `source` key calibration points have never had. Auto points are marked in the label (`[auto] …`), and that is what is counted now.
- **Events before the panel's settings arrive are no longer dropped.** The landing view, a `?view=` deep link and a throw during the first render all happen before the opt-in switch is known, and every one of them was discarded — the report could never count the landing tab and could never see the exact class of error (`ui_error:` on first render) it was added for in 0.36.7. All panel events now go through one door that queues until the switch is known, then sends or discards; the landing view is counted once.
- **Three reported feature flags did not exist.** `trackability_rating_enabled`, `compass_ring_enabled` and `replay_timeline_enabled` were settings keys consumed by nothing; they are out of the report, and a test now fails if any reported flag has no consumer outside the settings plumbing.
- **The two placement tools report their use**: `master_changed` / `master_change_refused` / `point_align_applied` join the closed vocabulary, so `health.stack_desync` has a denominator — without one, a zero means "fixed" and "nobody ran it" in the same breath.

### The release tells the install base it happened
- **`version.php`'s manifest is published by the release itself.** The daily update check reads `latest.json` on the colo, and that file was hand-maintained: 0.35.0 went stable on 18 August and five days later the manifest still said 0.21.13 — which is why two thirds of the pinging install base was still on 0.21.13. `release.py` now bumps `latest_beta` on every release and `latest_stable` on a stable one, verifies through the live endpoint, and fails red (with a `--manifest-only` retry) if the colo write did not take. `version.php` itself joins `server/` in the repo with the other two endpoints.
- **The release commit now stages `CHANGELOG.md`, `server/` and `docs/`** — the changelog no longer needs a second hand-made commit after every release.

---

## 0.36.9 — Install Base: the developer's dashboard of what the reports add up to (2026-08-21)

### Added
- **Install Base view** (Dev menu, PadSpan Pro). What every opted-in report adds up to, drawn in the panel: installs lifetime / active / new / lapsed / Pro; reporting and pinging installs per day; every install's latest report bucketed by version, Home Assistant, tier, scanners, floors, rooms, maps, calibration points, IRKs, walls, lights and objects; which integrations and feature switches are present in how many installs; health flags by installs affected; identity (IRKs registered, resolving, silent); geometry (faulted, anchorless, default heights); tabs, tools and warnings summed over the window with the number of installs behind each; and one row per install keyed by the first eight characters of its random id.
- **The whole install base, not just the opted-in slice.** The update-check ping log is the only signal from installs that never opted in. `stats.php` counts distinct callers per day and per version, hashing the IP column on the way through and never emitting it. First read: 184 installs pinged today against 5 reporting — and two thirds of them are still on 0.21.13.
- **Three gates, one lock.** The view is Dev-menu only and needs Pro tier, but those are courtesies: the server (`server/stats.php`) admits a key only if its SHA-256 is on its developer list. A Pro customer gets a clean refusal, never a look at other people's houses. The key travels in a header, never a URL. Five-minute cache on both sides.
- **An install ledger** (`telemetry.php`) keeps first/last day and days-reported per id, so the lifetime count survives the 90-day spool trim.

---

## 0.36.8 — The usage report is asked for, once, where people are looking (2026-08-21)

### Added
- **The panel asks.** The opt-in switch has existed since 0.35.0 and nothing in the software ever pointed at it: every install that opted in belonged to someone already on GitHub describing their bugs in prose — the population the report needs least. Now it is asked for **once**, in the two places a person is actually looking: as the last row of the setup checklist on a new install, and as a card on Overview for an install that finished setup before the switch existed. The card says plainly that PadSpan is bleeding edge, developed against one house, and needs all the help it can find; **Preview what would be sent** sits beside the buttons; **No thanks** ends it for good. Either answer sets `telemetry_asked`, the card never returns, and the switch itself stays in **Settings → Presence** whichever way you answered. Asking is not defaulting: nothing is sent until someone presses yes.

---

## 0.36.7 — The usage report can see an install where nothing is set up, and can see the panel (2026-08-21)

### The building, or the absence of one (#66)
- **`calibration_no_floor`** — calibration points that never got a `floor_id`. Since #54 such a point is no longer assumed to be on the ground; it stays 2D, which is correct and also completely silent. The point is there, it looks captured, and the storey it was captured on quietly has fewer than the panel shows. `async_backfill_floors` has always repaired them — nothing ever said who needed repairing.
- **`floors_with_height` and `scanners_with_z`, with `floors_all_default` and `scanner_z_uniform`.** A floor with no explicit `floor_to_floor_m` or `base_elevation_m` falls back to a default storey height, and a scanner with no `z_m` has no mounting height at all. Both are always set on the house PadSpan is developed against, which makes an install where neither is set the configuration I have never once seen. Cross-floor positioning there has nothing to separate storeys by. Both flags carry the multi-storey test inside them, so a bungalow is never reported as misconfigured.
- **`has_metre_anchor`.** `find_metre_anchor` has always returned nothing when no map in the house carries a reference measurement, and nothing ever reported that it had. Without an anchor there is no metre scale and every distance is a guess wearing units — and from a report, that install and a correctly measured one were identical.

### The half of PadSpan the log cannot see (#66)
- **`ui_error:<view>` — uncaught panel errors, counted by the view that was open.** v0.35.0 shipped a Mapping tab that threw before it re-rendered: the previous tab stayed on screen, it read as a hang, and nothing in `errors` moved, because a throw in the browser is not a Python log line. It took a user describing it in prose to find. Now it is a count per view from the same kind of closed vocabulary as the tab list, throttled to one per view per minute so a throw inside a render loop reports once rather than as fast as the loop runs. The message and the stack stay in the console, where they are free to name rooms and entities.

### Fixed
- **The opt-in report's own settings path was wrong in three places.** It is **Settings → Presence → Help improve PadSpan**. "Update Check & Privacy" is not a tab and never has been; it was stated as one in `telemetry.py`, in `panel.js` and in the README, and a user corrected it twice in #39 before it was fixed here. A test now fails if the phrase comes back.

---

## 0.36.6 — The usage report can tell a key that never works from a key nobody added (2026-08-20)

### Identity health
- **`rpas_seen` / `rpas_resolved` was never a resolution metric**, and reading it as one is a mistake already made once against real data. `count_rpas()` counts every structurally-resolvable address on the air — every rotating device in radio range, so overwhelmingly other people's phones, watches and passing cars. The ratio measures what fraction of your neighbours belong to you, and a low one is the ordinary result in a normal home. Both fields stay, because how crowded the air is bears on history size and CPU, but they are now labelled as describing the *environment* and the comment says what they are not.
- **`irks_silent` — the failure the report could not see.** Of the identities an install actually registered, how many resolved nothing at all in the window. A key that is present and never matches used to look exactly like a key nobody added: both were a zero.
- **`has_any_identity`.** Without it every zero above is unreadable, because "none configured" and "none working" are the same number and completely different bugs.
- **`irks_by_source` / `irks_resolving_by_source`.** Identities arrive by five doors — `private_ble_device`, `bluetooth_bond`, `mobile_app`, `companion_sensor`, and PadSpan's own list — and nothing said which of them carries the load or which of them works. Labels come from a fixed vocabulary, so an unknown source is bucketed as `other` rather than travelling as itself. Counts and fixed labels only; device names never leave the resolver.
- A preview reads the identity window without resetting it, as with every other window; only a send consumes.

### Tests — 988 to 992
- The breakdown, confirmed as cover by mutation: counting every key as silent fails 2, passing an unknown source label through fails 1, asserting an identity exists when none does fails 1, lumping all sources together fails 2. Two of the new tests also assert that a house with named devices puts none of those names in the payload.

---

## 0.36.5 — A scanner's name is not part of another scanner's, and the report can now tell these apart (2026-08-20)

### Identity
- **A shared name prefix no longer moves several scanners at once.** Reported by p976dtrsg2-droid: with proxies named `btproxy`, `btproxy_livingroom` and `btproxy_kitchen`, assigning an area to one moved others with it. Radios were matched to their HA device by a two-way substring test against every device name, taking the first hit out of an unordered registry — so `btproxy` answered for all three, and which won could change between restarts. Three copies of that rule: `snapshot_builder`, which is the one that produced the reported behaviour because it sets both `device_id` *and* the displayed area for every radio, and twice in `ws_radios`. The Overview prefers `device_id` over a name when calling `radio_area_set`, which looks like the safe path, but the `device_id` had been chosen by the same rule and was already wrong.
- **Containment is not identity.** Resolution now lives in one place, `RadioDeviceIndex`: a MAC from the source against the device's connections, then the whole name compared as a slug so "Living Room Hub" still matches `living_room_hub`, then containment *only* where it names exactly one device — which keeps installs working where the names are related without being equal, and stops a shared prefix claiming three scanners. Anything ambiguous resolves to no device at all. A scanner with no area is a visible gap someone can fix; a scanner holding another scanner's area is a wrong answer that looks right.
- **The refusal says why.** `radio_area_set` reports the colliding names back, and the Overview shows the server's message instead of "Failed to update. Check HA logs." A refusal nobody can read is just a failure.

### The usage report can now tell two geometry faults apart
- **Which signal tripped**, split across `geometry_fault_iso` / `_scale` / `_origin`. A lumped fault count says something is wrong and nothing about what, which sends this straight back to asking people for screenshots.
- **`anchor_is_affine` and `maps_affine`.** A trimmed Point-Aligned map and a trimmed ordinary one fail differently and are indistinguishable from a fault count. The anchor's kind is the discriminator, and it is currently the open question on #62.
- **`stack_desync`** — Point-Aligned maps whose matrix and whose decomposed fields no longer describe the same footprint. Nothing could see this before: such a map draws correctly through its matrix while every stored number disagrees. It is the exposure metric for #64 step 3, which is known and not yet fixed.
- **`radios_ambiguous` / `radios_unresolved` / `radios_matched_partial`.** The naming collision above had to be noticed, troubleshot and written up by a user before it was visible at all. Counts by outcome only — never which radios, never their names.

### ESPresense
- **The ingestion has tests for the first time.** It was already wired at startup, toggled from Manage, torn down on unload and feeding the snapshot; what it did not have was a single test over 370 lines of parsing against a wire format with three traps it documents about itself — the scanner identity living only in the topic path, rssi and distance arriving as JSON strings, and bare-hex MACs. Each is a silent wrong answer rather than a crash.
- **The README says how it actually works.** It claimed PadSpan works with existing ESPresense scanners without mentioning that they arrive over MQTT, need HA's MQTT integration, and are off until switched on. All true, none of it stated.

### Tests — 933 to 988
- The scanner resolver, the ESPresense callbacks and `stack_desync`, each confirmed as cover by mutation rather than by going green. Reinstating the original substring rule fails 9 of the resolver's tests.

---

## 0.36.4 — Two placements that were read from fields nothing was using (2026-08-19)

### Geometry
- **The metre anchor reads the transform, not the fields it ignores.** 0.36.0 fixed the write side of the trim skew: `_recrop_stack` re-derives a map's stack when the picture is cropped, and its raw-affine branch rewrites `_m` and returns, correctly leaving `scale`/`scale_x_adj` behind because `stack_world_xform` ignores them entirely whenever `_m` is present. The read side kept its own copy of the old derivation — in `find_metre_anchor`, again in `map_geometry_faults`, and once more in the JS twin — so on a trimmed Point-Aligned map all three measured a footprint the renderer never draws, out of the values the trim had deliberately abandoned. All three now go through one shared `world_footprint()` that transforms the image corners and takes the two edge lengths, so it cannot describe a branch that is not in force. Correct under rotation by construction rather than by luck: the old form ignored rotation and survived only because rotation preserves length.
- **A fresh Point Align was never affected**, which is why this went unseen. The solver writes the affine *and* an AR-aware decomposition of the same matrix, so `scale * scale_x_adj` already equals the affine's x span exactly, including under shear. Checked against identity, anisotropic, sheared and rotated matrices: old and new agree to the last digit before a trim, and a map that was never Point-Aligned trims clean under both. The error is a pure function of the crop, `iso_error = |fh - fw| / fw`, zero for a square trim and growing with how one-sided it is.
- **Change Master clears the solved matrix it was resetting around.** Both of its stack writes are built with `Object.assign`, which spreads the old stack first, and neither override named `_m` or `_m_ar` — so a solved matrix survived a reset that zeroed every other placement field, and since `makeStackXform` prefers it, none of the reset reached the renderer. The map went on drawing at its old placement while its stored values claimed the origin at scale 1. Not an edge case: the wizard refuses to run unless the new master is already aligned to the current one, so the map being reset is exactly the map most likely to carry a matrix. Measured worst corner 0.2610 world units from where the fields claimed, centre invariant because the affine is centre-based, so it presented as the map rotating about itself.

### Known, not fixed
- **The Change Master relink (step 3) still mis-places maps that carry a solved matrix.** It composes their new placement from `x_offset`/`scale`/`rotation`, which are not the fields in force for such a map, then writes the result back into those same ignored fields — so the map does not move at all and is left behind when the world frame shifts. Those are the old master's alignment targets, so they are the likeliest to hold one. Clearing `_m` there too is unsafe: a map trimmed after being Point Aligned holds a correct matrix beside stale decomposed fields, and composing from the stale ones would overwrite the right answer. It needs the composition done on the matrix. Tracked in #64.
- **Neither of these is claimed as closing #62.** Whether the trim path is behind the report there depends on that install's main floor carrying `_m`, which is not established — Point Align writes the matrix to the target map, not the reference. Waiting on the answer rather than guessing.

### Tests — 928 to 933
- `test_point_align_anchor.py` drives the real `_recrop_stack` rather than a hand-built stack, so the reported 42% is derived from the trim fractions instead of tuned to match the report. Two of the five fail on revert with the original error. The JS halves of both fixes were checked by running the real transforms under node and comparing numbers, since there is no `package.json` and CI runs no JS.

---

## 0.36.3 — Phantom devices, a solver that claimed certainty it did not have, and the tests that found both (2026-08-19)

### Identity
- **An unknown address age is not an age of zero.** `update_address_memory` coerced a missing age to `0.0` and then compared it with the previous poll's, so a missing reading looked like a fall from whatever came before — the exact evidence the rule exists to demand, manufactured out of its absence. It marked a rotating device's abandoned address *durable*, which splits one phone into several objects: issue #63 inverted. An unknown age now carries the last known one forward and decides nothing.

### The spatial solver
- **A fit cannot be more certain than the measurements it is made of.** The position's standard error multiplied the geometric conditioning *by* the residual, so ranges that merely agreed drove the uncertainty to zero and the geometry never got a say. Three receivers in a line with exact ranges to a point two hundred metres away — a geometry that fixes the position only up to reflection across that line, so the solve cannot know which side of the receivers the device is on — reported **0.0 m** and published it. The residual may now raise the uncertainty above what the radios can deliver but never lower it below.
- **The "this solve is not determined" diagnostic is visible.** It was written and then overwritten two statements later, so the gate could fire on every poll of every device and never appear anywhere.

### Repairs and permissions
- **Rebuilding a map's alignment is an administrator action**, like the sibling repair that goes the other way. It writes the map store and saves it.
- **The repair dialog names the signal that actually fired.** A fault trips on any of three, and only two were explained, so a scale-only fault quoted a placement error that is inside its own tolerance — a number that reads as nonsense to someone being asked to approve a permanent change.

### Housekeeping
- A removed object is no longer reported as failing forever: the failure list is per-object state and was not cleared on eviction.

### Tests — 865 to 928
- **Poll-level harness.** The defects of the last three releases all got through because the helper was correct and the *caller* was wrong. These drive a real update cycle, and were verified by reverting this week's fix and watching them fail with the original error.
- **Per-object state lifecycle.** Every one of the coordinator's ~forty per-object dicts is classified, and adding one without classifying it fails the suite. It immediately found floor evidence surviving a device's absence.
- **The building footprint**, which shipped in 0.36.1 with no tests, on the check that decides whether a position is published at all.
- **Beacon durability at real advertising rates**, which established that the rule works only within a band of intervals — a beacon advertising once a second can never satisfy it, and a real two-beacon pack is merged into one object. Recorded rather than fixed; the fix changes device identity and belongs in a change of its own.

---

## 0.36.2 — A device that is outside and heard by nothing no longer stops the poll (2026-08-19)

### Fixed — a whole-install outage introduced by 0.36.1
- **The outside rule's diagnostic formatted a reading that was not taken.** 0.36.1 moved the verdict to a trailing window, which made "outside, and heard by nothing this poll" a normal state for the first time — and the debug line still formatted *this* poll's strongest reading, which is `None` in exactly that state. The `TypeError` escaped the per-object loop, the coordinator never assigned its data, and **every entity in the install froze at its last value**: maps stopped updating and a vehicle that had left was still drawn where it last was. The line now reports the value the decision was actually made from, and says `silent` when nothing was heard.

### One object's failure is one object's failure
- **The per-object pipeline is isolated.** Whatever a single device's state does, the other objects still get their poll: the failure is recorded against that object, it is emitted unrefined rather than dropped, and its traceback is logged once instead of every ten seconds. A house full of working sensors must not go dark because one tag is in a shape the solver did not expect. `PadSpan: N of M objects failed this poll` is the new early warning, and it should read zero.

### A device that comes back is not placed by where it used to be
- The re-entry reset cleared the vote window, the confirmed room and the coverage history, but not `_floor_evidence` or `_device_floor` — so a device that left and returned was still judged on the floor it was on before it went. Both are now cleared with the rest. Found by a test, not by a report.

### The coverage window is a duration, not a poll count
- `presence_poll_interval_s` is a user setting (1–60 s, default 5), so a fixed count of six polls meant 30 s on a default install and **a full minute** on one polling every 10 s. How long a device has been unheard is a fact about the device, not about how often this install happens to look. The window is now 30 s everywhere and the poll count is derived from the install's own rate.

### Tests
- **A poll-level harness.** Every significant defect of the last three releases got through because the helper was correct and the *caller* was wrong — issue #62, issue #63, and the crash above. These tests drive a real coordinator through a real `_async_update_data`, so the caller is exercised too. Verified by reverting the fix and watching them fail with the original `TypeError`.
- **Per-object state has one lifecycle, and a test enforces it.** The coordinator keeps per-object state in forty-odd dicts, each of which must be cleared on eviction and, if it describes a location, on return from an absence. Adding a dict without classifying it now fails the suite, so the question is forced at the point it is cheapest to answer.

---

## 0.36.1 — The outside rule reads a window, and the solver says when it did not find a point (2026-08-19)

- **The outside rule cannot be decided by one poll's thinnest evidence.** The rule reads the strongest scanner still inside the silence grace. When the scanner that hears a device best goes quiet that value does not degrade — it drops to the next best, which can be 25–30 dB lower, and crosses the floor in a single poll. Scanners are shared, so *every* device whose best hearer went quiet flipped in the same poll: the symptom was a whole house going outside at once rather than one device drifting. The verdict now comes from a trailing window, so going outside must survive sustained evidence while coming back inside stays immediate.
- **The solver reports whether the geometry determined a point.** A least-squares solve returns a point whether or not the receivers constrain one; when they all lie in roughly the same direction the residual surface is flat and the estimate slides out into a field. That flatness is measurable — it is the covariance of the fit — so the estimator now reports its own uncertainty, and an estimate that is not determined falls back to the seed rather than being fenced in by a bounding box.
- **The building footprint is the union of the rooms**, not a box drawn around them. A box can prove a point is outside the building and can never prove it is inside: the missing corner of an L, the yard between two wings and the driveway are all inside the box and inside no room.
- `scripts/release.py` reconfigures its console to UTF-8, so the Bright pass no longer exits red on the machine releases are cut from.

**Known issue:** this release introduced the outage fixed in 0.36.2. Upgrade past it.

---

## 0.36.0 — Trimming a map no longer skews the fabric, and an install can report a broken placement itself (2026-08-19)

- **Trimming a map no longer skews the fabric (#62).** A map's placement was stored twice — metric in the model, world in the map's stack — and a crop re-derived only one of them. The two metres-per-world-unit figures then disagreed, and rooms drew correct across and wrong down by exactly the map's aspect error.
- **An install can report a skewed map itself**, without the owner having to notice and screenshot it: a read-only check reports a map whose stored geometry no longer agrees with itself, surfaced in Health and in the Rooms placements table.
- **Rooms can repair a stale map alignment, and warns before you touch anything.** Which *side* is stale decides the repair. For a trimmed map the transform is the trustworthy half and the stack is stale, so the existing "Fix alignment" would overwrite the one good copy — a new "Rebuild alignment" goes the other way and leaves the stored placement untouched. It is refused unless the map is actually in that state, so it cannot flatten a deliberate hand alignment.
- **2025 panel chrome, as a selectable skin.**
- **Mapping sub-tabs work again** — `setMapsTab` threw before it rendered.

---

## 0.35.0 — Stable: PadSpan Bright's foundations, the Bluetooth view restyled, IRKs told the truth, and an opt-in usage report (2026-08-18)

The first stable since 0.34.4. Everything below shipped and was verified as pre-releases 0.34.5–0.34.11 on a live install before this promotion.

### The tier model and PadSpan Bright's foundations (not yet a separate download)
- One owner of "what may this install do" (`licence.py`): `free < bright < pro`, `effective tier = max(shipped floor, key tier)`. The floor is a build constant, never fetched — a lighting map never waits on a licence server. **A key with no tier field resolves to `pro`**, so no existing customer is demoted.
- Light placement now gates at `bright` rather than `pro`: a PadSpan Bright Pro key or a PadSpan Pro key both unlock it.
- **Mapping → Lights is never hidden.** Below the `bright` tier it shows the free lighting map — rooms, floors, one marker per light in its room, click to switch — with placement, shapes, sizes, WLED, Showcase and Fit room withheld from the *drawing only*. Nothing stored is touched; enter a key and every placement returns exactly as it was.
- An importer for anyone who maps a house in PadSpan Bright and later installs PadSpan HA (Health → Import from PadSpan Bright): backs up first, refuses a non-empty house, never merges.

### The Bluetooth view, restyled
- One visual language across all five sub-tabs: a four-bar signal meter and tabular dBm everywhere signal is shown, one chip vocabulary, one row treatment, key/value detail panes, empty states that explain themselves. Same screens, same controls, same data — the view had four ways to draw "signal" and three greys doing one job.

### Private BLE (IRK)
- **`irk_add` refuses what cannot work.** A value that is really an iBeacon UUID on the air is rejected and the beacon named — the Companion App shows that UUID on the very screen people look for the key, and pasting it produced "0 resolved" forever with no explanation. A key that resolves nothing is refused unless you save it unverified (the phone is away).
- A fingerprint bridge is an inference, not an identity: a bridged object is no longer marked identified, and a stale bridge expires instead of being resurrected from history indefinitely.

### Help improve PadSpan (opt-in, off by default)
- Settings → Update Check & Privacy → **Help improve PadSpan**. Once a day, counts, versions and flags only — never addresses, keys, device / room / floor names, coordinates, or timestamps finer than the day. **Preview what would be sent** shows the exact report; the code refuses to send anything identifier-shaped; the event vocabulary is a closed list; opting in is an administrator action. PadSpan is developed against one house — this is how features that only exist in yours get seen.

---

## 0.34.11 — The usage report describes a house, not an empty one (2026-08-18)

### Fixed
- **A report sent while nothing had built a snapshot said "0 scanners, 0 objects" about a full house.** Half the report — scanners, objects, resolver health — is read from the live snapshot, which is built on demand and cached; a send ten minutes after a restart, with nobody looking at the panel, found no cache and reported zeros. Caught on the very first real send. `send_now` and Preview now build one first (the builder serves its own cache, so it costs nothing when the panel is open).

---

## 0.34.10 — The usage report counts what it says it counts (2026-08-18)

### Added — usage report coverage
- Every name in the report's event vocabulary now has a real call site: calibration point added, capture started, forensics query, Showcase turned on, backup created / restored, factory reset, Bright import, wall removed, IRK validate — each counted only after the action succeeded. A test asserts the vocabulary can never carry a dead name again.
- **IRK resolution stats.** `usage.irk_resolved` ticks once per NEW rotating address a registered key resolves; `usage.irk_unresolved_rpa` once per NEW rotating address that matches no key; `health.irk_devices_resolving` is how many registered keys resolved anything since the last report — the answer to "does the IRK path work anywhere", which nothing could see before. Counts only: canonical ids never leave the resolver.

---

## 0.34.9 — Help improve PadSpan: an opt-in usage report (2026-08-18)

PadSpan is developed against one house; features that only exist in yours never get seen. This release adds a way to change that — **off by default, opt-in, counts only**.

### Added
- **Settings → Update Check & Privacy → Help improve PadSpan.** Opt in and once a day PadSpan POSTs a ~2 KB JSON report to `padspan.traks.ca`: version / edition / tier / HA / Python; how many scanners (by kind and state), floors, rooms, placed lights, walls, maps, calibration points, IRKs, followed devices, objects (by kind), which related integrations are installed; which feature switches are on; how many times each tab and tool was used since the last report; health flags (crypto ok, BLE callback alive, coverage floor active, rotating addresses seen / resolved, outside attribution firing, positioned objects); WARNING/ERROR log lines by module. **Never** MAC addresses, keys, device / room / floor / entity names, coordinates, or timestamps finer than the day.
- **Preview what would be sent** shows the exact JSON before or after opting in; **Send a report now**; **New anonymous ID** replaces the random install id (the only thing that persists between reports).
- `telemetry.assert_shareable` walks every value before a send and refuses the whole report if anything identifier-shaped is in it — the belt over the design's braces. `tests/test_telemetry.py` builds a report from a house full of names, MACs, UUIDs, keys and coordinates and proves none of them are in it, and that the gate refuses each shape.
- Events are an allow-listed vocabulary (`telemetry.EVENTS` + `tab:<view>[/<sub>]`); anything else is dropped. Nothing is counted and nothing leaves the box while the switch is off — including the panel's tab events.
- Reviewed adversarially before shipping (three lenses, every finding verified against the code); the twelve real ones are in: the event vocabulary is a closed list mirroring the panel's tabs (asserted by test), opting in is an administrator action, the usage and error windows start at opt-in, at most one report per UTC day is persisted across restarts, counters are consumed only after the server accepted the report, uptime is a coarse bucket, MAC/IPv6/entity-id shapes in any notation are refused, and the README lists every field.
- `server/telemetry.php` (the receiver: append-only JSONL per day, no IP stored, same shape checks re-applied) and `server/telemetry_summary.py` (installs by version, environment distributions, features on, usage, health, and WARNING/ERROR by module across the fleet — the fix list). Data lives on the developer's server, never in the repository.

---

## 0.34.8 — IRKs: refuse what cannot work; a bridge is not an identity (2026-08-18)

Found by asking "has an IRK ever resolved here?" and checking. The resolver's AES matches the Bluetooth SIG sample data and is wired into ingest — it had simply never been given a real key.

### Fixed — Private BLE
- **`irk_add` refuses a value that is really a beacon UUID**, and names the beacon: the Companion App shows the iBeacon UUID on the very screen people look for the IRK, and a UUID pasted as a key resolves nothing, forever, with "0 resolved" the only symptom. Checked against every iBeacon on the air and every `*_ble_transmitter` sensor's `id`. No override — waiting will not make a UUID resolve an address.
- **A key is saved only if it resolves a rotating address on the air right now**, or if the person explicitly saves it unverified (the phone is away). The old flow validated, said "Saving anyway…", and saved. Both add forms and "Test only" now say why a key will never match when that can be said.
- **A fingerprint bridge is an inference, not an identity.** A bridged object no longer takes `identified` from a device link found under one of its addresses, and a cached bridge that is not current expires like any unidentified object — at once if its address is on the air under a real identity (an iBeacon group owns it). On the live install a CP27 beacon that had once been wrongly bridged had been resurrected from object history for 20 hours as "Private BLE: 1 device tracked".
- `tests/test_irk_add_refuses_what_cannot_work.py` — including the resolver against the SIG sample vector, which nothing had pinned before.

---

## 0.34.7 — The Bluetooth view, restyled (2026-08-17)

Same screens, same controls, same data — one visual language instead of several. Nothing about how the view works changed.

### Changed — Bluetooth
- **One vocabulary, defined once.** The view had four ways to draw "signal", three greys doing one job, two badge systems and around ninety inline colour strings, so the same idea looked different depending on which sub-tab you were on. `styles.css` gains a single `#bluetooth`-scoped block — stat, segmented tabs, chip (seven tones), a four-bar signal meter, row, panel, key/value grid, empty state, notice, note, micro-button tones — and `views/bluetooth.js` speaks it: `sigEl` / `chip` / `emptyState` / `btAgo` are defined once at the top of the file and used by every sub-tab.
- **Signal reads the same everywhere.** A four-bar meter and a tabular dBm reading, in the advertisement rows, the per-scanner device table and the detail pane alike — it used to be a coloured pill in one place and a percentage bar in another.
- **Rows say what they are.** Each advertisement leads with the scanner that heard it and the device's name, with the address and enrichment beneath; each scanner row carries its identity, how much it is trusted (a filled track, not just a number) and its own controls in a quiet cluster below a divider.
- **Empty states explain themselves** rather than stating the obvious, and the numbers are tabular so columns of dBm line up.
- Selection is a class with an accent rail, not a style string appended at runtime; the graph's embedded `<style>` no longer duplicates colours the stylesheet owns; the runtime colour writes go through the tokens.

### Fixed
- **200 advertisement rows collapsed to 18px each** when the list was given a scroll height: a flex column shrinks its children to fit by default. Items in a scrolling flex column are now `flex:0 0 auto`. Found by looking at the live install, not by the suite.

---

## 0.34.6 — The Lights tab at free tier (2026-08-17)

### Changed
- **Mapping → Lights is always there** (outside Basic mode). Below the `bright` tier it shows the free lighting map — rooms, floors, one marker per light, a hex switches the light — with the build tools (Transform, drag, the inspector, the unsaved-work bar) withheld and one line saying what a key adds. It used to hide without a key, which would have left PadSpan Bright's free program with no lights map anywhere until the sidebar panel was found and enabled. Verified on the live install by flipping the tier override to free and back: the free view drew, and every placement, shape and mode came straight back.

---

## 0.34.5 — PadSpan Bright: the tier model, the free lighting gate, the generated edition, the importer (2026-08-17)

Four programs from two dials — the EDITION (which build was downloaded: full or bright) and the TIER (what the key says: free < bright < pro). PadSpan HA and PadSpan Pro are unchanged for everyone running them today. Plan: `docs/padspan-bright-plan.md`.

### Added — licence and editions
- **`licence.py` — one owner of "what may this install do".** `effective tier = max(shipped floor, key tier)`; the floor is a build constant, never fetched, so a lighting map never waits on the licence server. **A key with no tier field resolves to `pro`** — every key issued so far is a Pro key, and the demotion guard test pins that. `license_tier_override` (Settings → Edition & tier, dev-only) can only lower the tier, so the free experience can be looked at without a free install.
- **`views/editions.js` — every navigable surface classified once** (`lighting` / `presence`); a Bright build renders the lighting surfaces (Mapping, Health, Settings) and a reveal switch shows the rest. `tests/test_editions_map.py` asserts the map is total against `panel.js`, so a new tab that is not classified fails the suite instead of leaking into the lighting product.
- **Light placement gates at `bright`**, not `pro`: a PadSpan Bright Pro key or a PadSpan Pro key, one ladder, one comparison. Forensics stays `pro`.

### Added — the free lighting gate
- Below `bright` the shared lights pipeline draws rooms, floors and one default marker per light at its room centre; placements, fixture shapes, sizes/rotations, the W-series/WLED distinction, Showcase, Fit room and Hide untouched are withheld **from the drawing only**. A read-time override in `views/lights_map.js`, applied for both hosts (the Lights sidebar and Mapping → Lights). `tests/test_lights_free_gate.py` renders the real card under node at free/bright/pro/garbage tiers and asserts the stored model comes out byte-identical — a lapsed key never touches a placement.

### Added — the generated edition
- **`scripts/bright_build.py`** derives PadSpan Bright from the tree being released: copy, four string renames (`padspan-lights`, `padspan_ha`, `padspan-ha`, `PadSpan HA`), two directory renames, `EDITION = "bright"` stamped, manifest/hacs.json/README named, then `verify()` greps the output for every old name and `build()` proves `git status` did not move. The renamed suite runs inside the generated tree (750/750 first time). A Bright build forwards no entity platforms and wears a lamp in the sidebar. `release.py` runs the pass after the full release is out; `BRIGHT_PUBLISH = False` until the listing goes live; `--no-bright` skips it. `tests/test_bright_build.py`.

### Added — the importer
- **Health → "Import from PadSpan Bright"**, shown only when `.storage/padspan_bright.*` exist and the house has not been imported. Back up first (the ordinary Backup/Restore snapshot; no snapshot, no import), **refuse a non-empty target** and say exactly what is there, never merge; then file-to-file through HA's Store for fabric, model, maps and settings, the map images, a receipt stamped into settings, and a config-entry reload so every store re-reads its file through its own setup path. Bright's own data is left in place. `bright_import.py`, `ws_bright_import.py`, `tests/test_bright_import.py`.

---

## 0.34.4 — Outside, by the site's coverage envelope; auto-calibration writes fingerprints (2026-08-17)

### Added — positioning
- **Outside attribution.** A device on the property but not in the building is heard by every indoor scanner faintly, and the strongest of several faint readings is a perimeter room — a parked vehicle lived in a closet. What is always true of an outside device on a covered site is that no scanner hears it well, and the site now measures that about itself: the **coverage floor** is the low tail of the strongest reading over its indoor calibration fingerprints (modelled from scanner geometry until it has enough; inactive on a site with no outdoors). Below it: the indoor solve does not run; if an outdoor scanner hears the device, that scanner's area is the room; otherwise the nearest scanner's room stands and `outside: true` says what it is worth. 4 dB hysteresis; the two numbers that decided it are in diagnostics and the map tooltip; the capture header records the floor. Plan and options: `docs/outside-attribution-plan.md`.

### Fixed — calibration data
- **Auto-calibration wrote one scanner's reading, not a fingerprint.** One Kalman value per scanner every ten minutes — including scanners only decaying toward silence — so every auto point failed the sample gate and was kept as its single strongest reading, flagged undersampled: 406 on the reference house, fifty of them "−95 dBm from one scanner = Bedroom Closet". k-NN matched them on any faint reading. Raw samples now accumulate per scanner and a point is written when at least two scanners each have enough (the rule the live k-NN query applies to itself). A migration drops the one-scanner auto points — made by us, no location information; points a person recorded are untouched.
- One outdoor-floor vocabulary (`const.OUTDOOR_FLOOR_NAMES`), read by the storey ranking and the outside rule alike.

---

## 0.34.3 — Identity, walls and lights in the fabric; websocket.py split (2026-08-17)

### Fixed — identity (the "closet beacon" flips)
- **Four CP27 beacons were one object.** MAC Rotation Bridging linked a "new RPA" to a cached identified one on a matching advertisement fingerprint without checking that the old address had *stopped*; `48:87:2D:…` is a public OUI the RPA heuristic false-positives on, all four share one fingerprint, so live beacons were chained together — and once bridged they were excluded from iBeacon grouping, so the pack/rotator split never got its turn. The merged object's vector alternated between two closets; what looked like a room-vote flip was two beacons taking turns. A bridge now requires the address bridged *from* to be silent (>5 s or gone), and an advertiser that names its own identity (iBeacon) is never fingerprint-bridged.
- **Same-label dedup merged on a name.** A live beacon that inherited "MaschineBOX" through its MAC was folded into a stale cached ghost wearing the same label (the ghost's frozen RSSI won), so the live object vanished from the list every poll. Two objects merge only when they share an address, and the freshest one is primary.
- **A pinned room decides the floor** exactly as a voted one does; **entity trackers** get a floor too. One rule, one site, after every way the room can be set.
- **Basement Warp drew nothing**: 127 calibration points had no floor. Save time now resolves a blank floor from the room's fabric floor; a one-off migration gives stored floorless points their room's floor, else the floor of the plan they were placed on.

### Fixed — structure (fabric only)
- **Lights** have one write path — metres — and the Pro gate and appearance validation live on it. The per-photo `lights` list (and the gate that guarded only it) is gone; the shape vocabulary is the renderer's, in one place (`const.LIGHT_SHAPE_KINDS`).
- **Walls have an identity**: every barrier carries an id (migration gives stored ones theirs, cuts their `map_id`); set/remove by id; the per-photo `rf_barriers` list is no longer accepted or created. The Edit tab still *draws* a wall on the photo — it goes through the map's metre transform into the fabric the moment it is finished, and the walls shown there are the fabric's projected back. The 2D radio map and distortion grid take walls from the fabric in the world frame. Per-map `radioMapSVG`/`distortionMapSVG` are gone.
- **Library thumbnails** show the fabric's rooms and scanners projected onto the picture.
- **RPA resolution cache bounded** (4096); the room-scoring `_sigma` knob removed end to end (never ran).

### Changed — code structure
- **`websocket.py` split by subject**: 11,942 lines → registration + twenty modules (`ws_*.py`, `snapshot_builder.py`, `ws_common.py`). Every name is re-exported from `websocket.py`; the panel sees one API. Layout in the module docstring.

---

## 0.34.2 — The map is drawn from the fabric, storey by storey (2026-08-17)

### Fixed — Overview / Pure Live
- **Heat and Warp overlays drew nothing.** They sized their grid from the corners of the *photographs* at a level, through a per-photo pixel transform that indoor plans no longer carry — so the extent was empty and both returned `""` with a clean console. They now take a *storey* the overview resolves from the fabric (rooms, scanners with vertical offset, barriers, calibration points — all in metres) and size the grid from the storey's rooms. Storeys share one colour scale computed from the model, so a badly covered floor cannot look green by being scaled to itself. The render harness now asserts both overlays draw.
- **The storey loop iterated photographs.** A floor with rooms but no picture drew nothing, and neither did anything on it. The loop is now the fabric's storeys. Walls are drawn once per storey (per photo drew every wall twice on a floor traced from two pictures); scanners come from `scanner_positions_m` (a radio placed in metres but never pinned on a picture had no marker); a scanner's "Area" is the room polygon that contains it.
- **Pure Live labels were giant again — at every zoom, and after every poll.** Its zoom counter-scale *overwrote* each marker's transform with `scale(1/zoom)`, discarding the annotation scale the overview had baked in. The overview now publishes the scale on the svg root (`data-ann-k`) with an anchor on every annotation (`data-ann`), and Pure Live composes `k / zoom` with it. The scale is one number substituted when the svg is composed, so it no longer depends on what was drawn before what; it measures the container's content box, not its padded width; a width change rebuilds the svg in place wherever it is hosted.
- **Dotted circles floating around the map.** Confidence rings and the outside-the-building ring were drawn *outside* the scaled marker group — and in one branch with no marker at all. Inside the group now, along with the floor badges and the legend row.
- **A floor beside the ground floor was placed a storey up.** `floor_base_elevations_m` read the running sum after it had already advanced, so "Outside" came out level with the bedrooms (5.6 m on the live install). Same-storey floors share the storey's base.

### Fixed — positioning
- **An object is on the floor of its room.** The room is the vote's answer; the solvers' per-poll floor was a second, undefended one — as evidence thinned, spatial (sticky) and k-NN (raw) took turns supplying it, and the *floor* flipped upper↔main every few polls on a beacon whose *room* never left the closet. Measured: 26 floor-change events in a 55-frame capture, all but three on objects whose room did not change. The solver's floor stands only for an object whose room the fabric cannot place — and a *pinned* room decides the floor exactly as a voted one does (pins are applied last, and used to leave the solver's floor in place). Verified on the live snapshot after deploy: every tracked BLE/iBeacon object's floor equals its room's floor.
- **k-NN needs two live scanners.** One reading against several hundred fingerprints matches whichever stored point has that scanner at about that level — on a real house routinely an *outdoor* point. Seventeen of twenty-two floor flips in a ten-minute capture were this.
- **A thin poll holds the last position** for the same window the RSSI stage holds a silent source, instead of handing the object to whatever k-NN said from one faint reading.
- Learned floor attenuation was tried in floor selection against the same capture, made it worse (7 → 24 events), and is not shipped.

### Removed
- **Client-side positioning in the overview** — a fingerprint match and an RSSI-weighted centroid of scanner *screen* positions that filled in behind the server. Two more opinions on where a beacon is, in a spot no other view agreed with. The server places things; the map draws (server position, else room centroid, else nothing).
- **`room_sigma_m` and the "Gaussian room scoring" it configured** — described in the pipeline docstring, the settings card, the QA formula panel and the capture header; never what ran. Removed end to end.
- Per-photo iso heatmap, its legacy calibration variant, the module-level global colour range, and the overview's copy of hidden-map sync.

### Fixed — resource
- The RPA resolution cache is bounded (4096); expired entries are evicted once it is full. Every address heard was cached and never evicted — ~1,800 a poll on a real house.

### Docs
- `03_MAPPING_SUITE.md`: storeys and overlays from the fabric; the annotation contract. `09_HARD_WON_RULES.md`: two views drawing one thing share a contract, not a guess; when something "no longer works", check what it is still reading.

---

## 0.34.1 — Positioning stops acting on evidence it does not have (2026-08-17)

Measured on a live three-storey house before and after, same method: **floor flips per minute 9.7 → 4.9**, and the "gap" polls where the heard scanner count collapsed to 4 are gone (minimum now 10). Groups of beacons sliding off position together for three or four polls — the thing that made the whole map look flakey — was one root cause seen from three angles.

### Fixed — positioning
- **Anchors dropped after one missed poll.** The spatial solve discarded a scanner the first poll it went quiet, while the Kalman stage a few lines above was deliberately holding that scanner's last real value through the silence grace window. Two stages in one function contradicting each other. BLE advertisements miss polls constantly, and every device loses the *same* scanner on the *same* poll — so they all re-solved from the same reduced anchor set and moved as a group, in whichever part of the house that scanner anchors. A source now leaves the solve when it starts *decaying*, not when it merely misses.
- **Position had no plausibility gate.** RSSI has a Kalman covariance and a silence grace; rooms have to win a vote window; the α-β position filter accepted half of any residual unconditionally, and fed it into velocity, so one bad measurement gave the dot momentum in the wrong direction on the next poll. A step implying more than 5 m/s is now treated as a bad measurement — the filter coasts on its prediction, and believes the new position only after three consecutive polls agree (a beacon switched off and carried really does teleport).
- **Floor selection had no sense of how much it had heard.** It was recomputed from scratch each poll and compared on equal terms whether fifteen scanners had reported or two. A floor change now needs the device to have heard a fair share of what it *usually* hears, and to beat the incumbent by a real margin. An earlier version of this used an absolute quorum of three, which was unreachable — floor selection only runs once three scanners have reported. Fixed to be relative to each device's own norm.
- **Cross-floor scanners solved position.** A scanner one storey away hears a device through the slab; its reading says something about which floor and almost nothing about where on it. Two garage scanners at −74 dBm were dragging a device its own closet scanner heard at −63 down a storey and outside every room — while the room vote, which never used them that way, stayed correct. On-floor scanners now solve position whenever there are enough to solve at all; cross-floor readings are the fallback for a thinly covered floor.
- **The metre anchor's Python half.** `fabric_truth.find_metre_anchor` computed both axis scales and returned only x (issue #62's other side — the side that *writes* committed geometry and `map_transforms`). Both axes now.
- **"Excluded scanner" had four implementations**, and the two used by the live snapshot and by advertisement ingestion omitted `excluded_scanners` entirely — a receiver the user had masked because it physically moved went on placing objects. One rule in `presence_rules`, with a guard against a fifth copy.
- **A calibration point on an unmeasured map was saved with no position.** It counted toward every total and was ignored by every learner. Refused at save time now, with a message that says what to do.

### Fixed — Overview
- **The frame never saw the drawing.** `_isoBB`, which the svg frame is fitted to, was grown *below* the fabric early-return in `iso()` — so on every install with a fabric it stayed empty and the frame silently fell back to a fixed 880-unit heuristic around a ~500-unit building. That was the blank sides, and it is why five attempts to fit the drawing more tightly *inside* `fabricFrame` changed nothing visible.
- `max-height:${vh}px` capped the rendered width to about `vw` px regardless of the panel. Removed; the map fills its width and scrolls.
- Labels and markers are counter-scaled per group by designed-vs-actual pixels per unit, so a wider frame does not mean bigger words.

### Fixed — panel
- `_getModel` spread the whole `model_get` response instead of whitelisting keys. The whitelist had dropped a key three separate times (origin forwarding, the migration marker, `light_positions_m`/`floor_elevations`). Guarded so it cannot come back.

### Removed
- `_primaryMapIdForFloor` in `views/maps.js` — one reference, its own definition.

---

## 0.34.0 — RSSI Vector Capture, and a floor model that reaches positioning (2026-08-16)

### Fixed — multi-floor positioning

- **The floor list never reached the positioning code.** `ModelStore.data["floors"]` is the sole input to `floor_stack_index()` and `floor_base_elevations_m()`, and nothing ever wrote it. The panel looked right because it reads the HA floor registry live *for display* — but positioning found the single synthetic `main` entry the store is created with and ran **every multi-floor install as one storey**. Cross-floor RF paths all fell back to a flat one-slab penalty, so a basement scanner and an upstairs scanner were penalised identically and floor selection had nothing left to discriminate with. Measured on a three-storey house: 2,886,899 confirmed cross-floor room changes, split 1,093,120 / 1,062,985 between the two directions — a near-perfect symmetry, which is oscillation and not movement. Floors are now synced from the registry each poll, and any learned cross-floor attenuation gathered before this is suspect.
- **Two floors on the same storey were a slab apart.** `floor_stack_index()` returned enumerate() positions, so "Outside" and "Main" — both at ground level — came out one apart, and every outdoor scanner was charged 10 dB of concrete it never saw through. Indices are assigned per distinct storey now, and floors sharing a storey also share a base elevation instead of inventing 2.8 m of building between them.
- **Floors with no `level` set stacked in creation order.** HA's registry leaves `level` null on most installs, so an alphabetical registry stacked a house wrongly. Ordering now falls back to what a floor id means (`basement`, `ground`, `upper`, `attic`, and outdoors at ground) before it falls back to stored order.

### Fixed — four views that parsed and then threw

Each rendered blank with a clean console, because `panel.js` loads views with `.catch(console.warn)`:

- **2D Map Mode was dead entirely** — `liveSnap` and `helpBtn` were locals of `overview.js` that did not survive the extraction into `plan_viewer.js`.
- **Clicking an occupied room did nothing** — `_showRoomDetail` called `fmtAgo`, a local of `_showObjectDetail`. It is a shared helper now.
- **Floor heatmap legends threw** — `floorHeatmapSVG` read `_wpRssis`, a local of a different function.

`tests/test_frontend_renders.py` now imports every view under a DOM shim and calls its entry points, flushing deferred work. Verified as a real guard: with the `liveSnap` bug reintroduced, `node --check` passes and this fails by name.

### Fixed — the reason none of the above was visible

- **Frontend changes were invisible until a release.** `BUILD_ID` was a hard-coded literal in `build_info.py` and again in `panel.js`, so every asset URL kept the same `?b=` stamp between releases and browsers served cached JavaScript no matter what was on disk or how many times Home Assistant restarted. A new `ASSET_ID` appends a digest of the frontend tree, and `panel.js` reads the stamp off its own module URL so every view inherits it.

### Fixed — mapping

- **Delete room did nothing visible.** It cleared `room_meta`, adjacency and the scanner map — all ModelStore fields — and left `room_geometry_m` alone, which is where the shape lives. The room kept drawing and kept being a room the pipeline could choose. Removal is now one store call covering all four.
- **Floor slabs were the bounding rectangle of a floor's rooms**, 1.7–2.5× the real floor area on a house with a stairwell void or one outlying room. Each slab is the union of its room footprints now.
- **The 3D stack was sheared.** Every floor was drawn centred on its own bounding box, so storeys that overlap correctly in the fabric were pushed apart on screen — walls met at different angles per floor and set-back floors read as boxes in the wrong place. One building, one origin. Scale and centring also come from the projected shape now rather than the bounding diamond, which a building never fills.

### Added
- **RSSI Vector Capture** (Settings → Features, off by default) — record what every scanner heard for every tracked device, poll by poll, alongside the room PadSpan chose, then export the trace and replay the same walk offline against changed settings. Until now a positioning change could only be argued from memory: a room felt stickier, a floor flipped less. A capture makes the input reproducible, so a change can be scored instead of recalled.
  - Session-scoped. Nothing is written until you press Record in Health → Quick actions; a session stops itself at 60 minutes or 25 MB and says which cap it hit.
  - **Mark room** stamps ground truth while you walk, which is what turns a recording into something that can be scored rather than merely replayed.
  - Records **identified or followed devices only** — the same rule the traceback uses. Measured on a real house, that is about 12 devices out of ~1,800 BLE objects per poll; the rest are neighbours' phones heard by one or two scanners, useless to a positioning fixture and not ours to record.
  - Exports as `.jsonl` straight from the browser. `tests/test_capture_replay.py` loads an export as a pytest fixture and scores it two ways: against the answers the pipeline gave when recording (a refactor that moves one answer fails), and against your own room labels (a tuning change becomes a number).
  - Captures are not included in backups, and a factory reset deletes their files as well as their index.

### Fixed
- **Per-device state no longer accumulates for the life of the process** — `_spatial_debug` was written for every object key from four places and cleared from none, so every rotating Bluetooth address that ever passed the house left an entry behind. Invisible on a home install; unbounded on a large one. The guard that should have caught it listed the state dicts by hand, and now discovers them instead, so the next one is caught the first time it is populated.

---

## 0.22.7 — Lights placement (Pro) + private-BLE and map-migrate fixes (2026-08-10)

### Added
- **Lights map placement** (PadSpan Pro) — place your lights on the floor plan from the Mapping view's Lights tab, rendered as a room-polygon view. Saving light placements requires an active Pro license; everything else in Mapping is unaffected.

### Fixed
- **IRK table Delete button targets the right entry** — devices with identical names were merged by an internal name-keyed join, so deleting one row could remove a *different* device's config entry. Rows now carry their own entry identity, and renamed devices show their new name immediately instead of after a restart.
- **Adding an IRK no longer leaves phantom config flows** — each failed format attempt now cleans up after itself (they used to accumulate as in-progress flows until restart), and re-adding the same IRK in a different format/byte order is correctly detected as a duplicate instead of creating a second entry.
- **Delete & Migrate now actually moves calibration points** — a wrong field name meant migrated points kept their old on-map positions while being re-owned to the target map. Positions now transform correctly.
- **3D alignment editor: different-aspect maps open undistorted** — the editor sizes its stage to the reference map, which pre-stretched any target with a different aspect ratio and forced users to hand-hunt the X-stretch correction (destroying precise 4-point alignments along the way, part of the issue #56 chain). A never-aligned target is now auto-corrected on selection.

---

## 0.22.6 — Re-anchor hardening (2026-08-09)

### Fixed
- **Re-anchor no longer adopts stray calibration points** — remapping after a re-anchor could claim orphaned points (from deleted maps or other floors) that happened to land inside the map under the chosen pose; a wrong pose would then make the corrective re-anchor impossible. Re-anchor now only ever moves points the map already owns.
- Re-anchor preflight tolerates malformed calibration points, and the origin readout in the Measure panel updates immediately after a successful re-anchor.

---

## 0.22.5 — Map origins are now anchored (2026-08-09)

### Fixed
- **Display edits can no longer redefine world coordinates** — a map's real-world origin and rotation used to be re-derived from presentation state (stack offsets, master flag) whenever a map was re-measured, migrated, or had its image replaced. Moving a map in the 3D alignment editor and then re-measuring could silently shift every calibration pin's world position (the root cause behind issue #56). The world pose is now **write-once**: set when a map is first measured, preserved through re-measures and image replacements, and changed only by the new explicit re-anchor action.
- On upgrade, every existing map transform is frozen exactly as it is — a one-time migration marks the stored pose as anchored without changing a single number, verified against a production dataset (9 maps, 746 calibration points, zero movement).

### Added
- **Re-anchor origin** (Measure panel) — the one sanctioned way to redefine a map's world origin/rotation. Your calibration pins keep their real-world metre positions and their on-map positions re-derive through the new pose. The action refuses (changing nothing) if the requested pose would strand most pins off the map, and rolls back completely if anything fails partway.

---

## 0.22.3 — Calibration & Private BLE fixes (2026-08-04)

### Fixed
- **Calibration pins no longer collapse to the map corner** (issue #56) — re-deriving point positions after a map save used to clamp out-of-range results to (0,0); when the map transform disagreed with stored metre coordinates this silently piled a whole floor's calibration into the upper-left corner. Out-of-range points now keep their existing positions, and a remap that would displace most of a map's points is aborted entirely.
- **3D stack alignment saves no longer touch calibration** — the alignment editor only writes the cosmetic stack transform, which calibration does not depend on; the save was needlessly re-deriving (and potentially corrupting) pin positions.
- **Private BLE devices now show their real names** (issue #57 root cause) — the IRK table displayed the config-entry title, which Home Assistant leaves as the original MAC address forever. It now prefers the device-registry friendly name, so your renamed iPhone shows as "Garry's iPhone", not `AA:BB:…`.

---

## 0.22.0 — Forensics (PadSpan Pro) (2026-08-04)

### Added
- **PadSpan Pro licensing** — Forensics is the first Pro feature ($45 CAD/year). Enabling it asks for a licence key, validated server-side against the traks.ca licence service. The rest of PadSpan remains free and unchanged.
- **Forensics mode** (off by default, opt-in via Settings → Features) — answers "which Bluetooth devices were near my scanners between X and Y?" (issue #55). While enabled and in Live mode, a background sampler records presence *sessions* per address every 60 seconds (a 5-minute silence closes a session), with configurable retention (7–90 days, default 14) and hard caps.
- **Forensics tab** — appears only while the setting is on. Time-window search with two confidence tiers: *Recorded* (actual presence sessions overlapping the window, with dwell time, peak signal, and scanners) and *Possible* (object-history first/last-seen span overlaps the window — lower confidence). CSV export for handing results to investigators.
- **Privacy guardrails** — always-visible privacy notice, explicit confirm before enabling, double-confirm data deletion, stats display, and reliability disclaimers throughout (a BLE address is not a person; rotating MACs mean most phones won't appear consistently; results are leads, not proof). Recordings never leave the Home Assistant instance and are never included in live snapshots.

---

## 0.19.0 — Stable Release (2026-03-24)

Consolidates all v0.18.x fixes into a clean stable release.

### Fixed
- **Version display corrected** — APP_VERSION in panel.js and lights_panel.js was hardcoded at 0.17.1 and never updated. Now all 5 version sources (const.py, build_info.py, manifest.json, panel.js, lights_panel.js) are aligned.
- **UI freeze from wizard crash** — wizard auto-complete and Skip button called `this.actions.settingsSave` before actions was initialized, crashing `_renderCurrentView` and freezing the entire UI. All `this.actions` references now use optional chaining.
- **Wizard only shows on Overview** — no longer blocks navigation to other tabs.
- **Wizard recognizes Beacon Tune calibration** — checks fabric scanner positions, not just Pin & Listen points.
- **k-NN logging flood** — 652 per-cycle warnings downgraded to DEBUG. Was choking the HA event loop and degrading WebSocket responsiveness.
- **Indoor devices misplaced outdoors** — outdoor room score damping now applies to all devices unless already confirmed outdoor.
- **Hidden floors hide objects in 3D overview** — objects on disabled floors no longer render.
- **Private BLE friendly names** on map, follow, and devices views.
- **Map scale save crash** fixed.
- **Occupancy training save crash** fixed.
- **HACS ZIP structure** — verified flat layout matching v0.17.1.

### Documentation
- README rewritten for v0.17+ features
- Getting Started and Floor Plan Setup guides updated
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization

---

## 0.18.2 — Stable Release (2026-03-24)

Consolidates all v0.17.2–v0.18.1 fixes into a clean stable release. Version string now consistent across all three sources (const.py, manifest.json, build_info.py).

### Includes
- Onboarding wizard: reordered steps, sub-tab routing, Basic mode fix
- Private BLE friendly names on map/follow/devices
- Map scale save, occupancy training save, blocking scandir fixes
- Documentation overhaul (README, Getting Started, Floor Plan Setup)
- New screenshots: Calibration Tune, Traceback Playback, Bluetooth Visualization
- Clean HACS ZIP (flat structure, no __pycache__)

---

## 0.18.1 — Onboarding Wizard Fix (2026-03-24)

### Fixed
- **Wizard step order** — reordered to logical sequence: Upload → Set Scale → Draw Rooms → Place Scanners → Calibrate. All map setup steps now run consecutively before calibration, eliminating unnecessary context-switching between views.
- **Sub-tab routing** — clicking a wizard step now navigates directly to the correct sub-tab (e.g., "Upload Floor Plan" goes to Maps → Upload tab, "Calibrate" goes to Calibration → Pin & Listen tab). Previously all steps landed on the default tab.
- **Basic mode calibration crash** — clicking "Place Scanners" or "Calibrate" in Basic mode now auto-promotes to Advanced mode so the Calibration view is visible. Previously these steps navigated to an invisible view.

---

## 0.18.0 — Stable Release (2026-03-24)

### Documentation
- **README rewritten** for v0.17+ features: Device Registry, positioning fabric, occupancy estimation, onboarding wizard, 2D map mode, measure tool, multi-floor intelligence, experimental features, movement playback, comparison table updated (22 views)
- **Getting Started guide updated** — onboarding wizard steps, Apple device tracking (Private BLE/IRK), occupancy estimation, movement history, troubleshooting for v0.17 fixes
- **Floor Plan Setup guide updated** — measure tool instructions, master map concept, 2D flat map mode, multi-floor alignment workflow
- **Documentation index** added to README linking all guides

### Fixed (from v0.17.2–v0.17.3)
- Private BLE devices show friendly name instead of MAC on map, follow, and devices views
- Map scale save crash (`scale_x_m` undefined)
- Occupancy training save crash (`async_save` → `store.async_save`)
- Blocking `scandir` in factory reset event loop
- Onboarding step click crash (`renderRooms` undefined)

---

## 0.17.3 — Bug Fix (2026-03-24)

### Fixed
- **Private BLE devices show friendly name instead of MAC** — map, follow, and devices views now use the resolved `private_ble_name` (e.g., "Adam's iPhone") when no user label is set, instead of displaying the raw rotating MAC address. Affects overview (2D, 3D, room chips, ISO stack), follow view, and devices list.

---

## 0.17.2 — Bug Fix (2026-03-24)

### Fixed
- **Map scale save crash** — "Save Scale" button referenced `scale_x_m` / `scale_y_m` before they were defined, causing `ReferenceError` and preventing scale saves (maps.js:1944)
- **Occupancy training save crash** — `ws_occupancy_train` called `_st.async_save()` which doesn't exist on `SettingsStore`; corrected to `_st.store.async_save(_st.data)` (websocket.py:8374)
- **Blocking `scandir` in event loop** — factory reset's map-file cleanup used synchronous `iterdir()` / `is_dir()` inside an async handler, triggering HA's blocking-call detector; wrapped in `asyncio.to_thread` (websocket.py:7508)
- **Onboarding step click crash** — `this.actions.renderRooms()` could fail with `TypeError` if `actions` was undefined during panel init; added optional chaining with fallback (panel.js:2414)

---

## 0.17.0 — Stable Release (2026-03-23)

Major release with 78 commits since last stable (v0.15.25). Introduces the Device Registry identity system, positioning fabric decoupling, multi-floor accuracy learning, occupancy estimation, and an onboarding wizard.

### Device Registry (NEW)
- **Stable device identity** — every physical device gets an immutable `padspan_id` (format: `ps_<12 hex chars>`) that survives MAC rotation, iBeacon UUID changes, and firmware updates
- **Identity resolution** — O(1) lookup from any volatile key (MAC, iBeacon, canonical_id) to stable padspan_id
- **Automatic migration** — existing labeled objects in ObjectStore are auto-migrated to DeviceRegistry on first startup
- **Label pipeline** — DeviceRegistry is now the primary label source; ObjectStore is a thin fallback
- **HA entity identity** — sensor and device_tracker entities use padspan_id for stable HA device identity
- **Frontend management** — Devices view has interactive registry: merge duplicates, add identities, relabel, delete, view identity chains
- **7 WS commands** — list, migrate, merge, resolve, label_set, add_identity, delete
- **Health checks** — Device Registry status, Label Pipeline health, dependent store migration progress

### Positioning Fabric (decoupling from maps)
- **Fabric is the authority** — all spatial data (scanner positions, room geometry, RF barriers, beacon positions) stored in real-world metres in the positioning fabric
- **Maps are setup tools only** — floor plan images no longer own positioning data, overview map toggle defaults to off
- **Metre-space coordinates** — all stores use real-world metres with floor_id references
- **Map transforms** — affine transforms convert between map fracs and metres
- **Measure tool** — two-point reference distance calibration with aspect ratio validation

### Multi-Floor Accuracy
- **Floor-transition learning** — adaptive store records floor-to-floor transitions with Welford stats on dwell time
- **Dwell-based velocity gate** — short dwell (<30s) requires unanimous vote; medium dwell (30-120s) needs supermajority for cross-floor; long dwell (>120s) uses normal threshold
- **Learned cross-floor attenuation** — Gaussian scorer applies learned RSSI corrections to cross-floor scanners when adaptive floor detection is enabled
- **Outdoor penalties** — outdoor scanners get 0.30x Gaussian damping; indoor-outdoor transitions require 4x floor stickiness

### Occupancy Estimation
- **Dedicated Occupancy dashboard** — new sidebar view with building summary, per-room breakdown, training controls, and training history
- **Hybrid counting** — identified devices count 1:1, unidentified BLE with dwell >5min count with configurable multiplier (default 1.5x)
- **Training** — enter actual headcount to adjust the multiplier via EMA learning

### Onboarding Wizard
- **Guided first-run setup** — persistent progress bar detects 5 steps: upload floor plan, set scale, place scanners, draw rooms, calibrate
- **Auto-detection** — each step auto-completes when its data is detected
- **Click-to-navigate** — each step links directly to the right view
- **Skip option** — dismisses permanently via settings

### Calibration & Beacon Tune Fixes
- **Room polygons no longer block dragging** — `pointer-events: none` on room polygons in both Tune and Beacon Tune
- **Save-pulse animation** — save button pulses green when there are unsaved changes (dynamically updated after drags)
- **Beacon sync to maps** — fabric beacons are now synced back to maps store for consistent rendering
- **Unique beacon IDs** — prevents drag handler from matching wrong beacon when multiple have empty IDs
- **SVG not rebuilt mid-drag** — `_refreshSVG()` checks `_dragging` flag
- **Watchdog fix** — no longer force-renders on non-live views (was disrupting calibration mid-drag)
- **Out-of-bounds beacons filtered** — beacons outside map coordinate range are skipped instead of clamped to edges

### Distance Traveled
- **Fixed data reading** — was reading `frame.objects` instead of `frame.o` (compact format), producing zero distance for everything
- **Jitter filtering** — steps <0.5m ignored, same-room capped at 3m, time-gap scaling for downsampled views
- **Reliability score** — shows what % of position steps passed the jitter filter
- **Investigate button** — popup showing total steps, good steps, jitter filtered, max step
- **Stationary references** — mark known-fixed devices as references; their phantom distance becomes a BLE accuracy diagnostic
- **BLE Accuracy rating** — Excellent/Good/Fair/Poor based on total phantom distance from reference devices

### Other
- **Donate button** added to README (PayPal)
- **Traceback** — padspan_id recorded on each frame object for stable history
- **Movement history** — padspan_id on room transition records
- **Follow alerts** — padspan_id auto-backfilled on startup
- **`padspan_id` in HA entity attributes** — visible in developer tools on area sensors and device trackers

---

## 0.5.91 — Hardware Guide & Cleanup (2026-03-01)

### Added
- **Scanner Hardware walkthrough** — New Training Hub walkthrough with animated SVGs covering antenna comparison, board recommendations, and why room-level tracking demands better hardware than home/away
- **Scanner Hardware manual section** — Detailed reference in Training Hub manual with tested board recommendations (ESP32-S3 + Ethernet, ESP32-S3 + WiFi, ESP32-C3 — all with external antennas)
- Hardware guidance added to Getting Started guide and README
- `.gitignore` updated to exclude dev artifacts

### Fixed
- `esc is not defined` error in Settings → Scanner Map (`_scannerMap()` function was missing `ctx.helpers.esc`)
- SVG XSS hardening in demo floor plan builder (room/radio/object names now escaped)

### Removed
- 21 legacy doc files (old v0.3.x install notes, placeholders, duplicates)

---

## 0.5.88 — Beta Launch Prep (2026-02-28)

### Added
- **BLE data enrichment** — Objects now show decoded company names (Apple, Samsung, Google, Xiaomi, etc.), device types (Find My, AirPods, Nearby Info), and GATT service names (Battery, Tile, Device Information) as color-coded badges. Search by company or device type in the Objects tab.
- **QA Radio Analysis card** — Per-radio health scoring with activity metrics, cross-scanner overlap comparison, and network info (IP, SSID, WiFi signal)
- **Development disclosure** — README, CONTRIBUTING, and repo topics transparently describe AI-assisted development process
- CI tests — 36 automated tests for maps store, object store, config flow
- GitHub issue templates (bug report + feature request)
- CONTRIBUTING.md with development setup guide
- `connectable` flag captured per BLE advertisement

### Fixed
- **Security** — Escaped all user-controlled strings in overview, maps, and settings SVG innerHTML (XSS prevention)
- **Security** — Admin-only gating on destructive WebSocket handlers (maps delete, area delete, entity delete, calibration clear, integration reload)
- **Security** — Map upload 20MB size limit + path traversal protection on file operations
- **Mobile** — Tooltip overflow on small screens, input minWidth overflow, toolbar wrapping
- **Performance** — Visibility handler and modal ESC listener now properly cleaned up on disconnect (prevents memory leak in long sessions)
- `esc is not defined` error in maps.js 3D Stack view
- Radio Analysis identity section words running together
- Network info only showing for one radio (backend now tries source slug)

### Changed
- Radio health scoring only flags provable issues — "Unhealthy" for hard failures, "Fair" for ambiguous, "Healthy" otherwise
- `binary_sensor.py` proper `async_setup_entry` stub (was causing silent platform failure)
- Config flow exception handling narrowed from `Exception` to `(ValueError, TypeError)`

---

## 0.5.79 — Training Hub & Documentation (2026-02-27)

### Added
- **Training Hub** — Guided walkthroughs for Overview, Follow, Objects, Maps, Settings, and Calibration
- 9 new Manual sections covering all remaining views
- Calibration walkthrough with 4-step animated guide
- Marketing screenshots and launch documentation

---

## 0.5.77 — HACS & Hassfest Validation (2026-02-27)

### Added
- HACS validation CI workflow
- Hassfest validation CI workflow
- Brand icon for HACS store listing

### Fixed
- manifest.json key ordering and removed invalid `icon` key
- services.yaml removed invalid `response` key, added proper `target`
- Added `bluetooth` to `after_dependencies` in manifest

---

## 0.5.75 — Major Feature Release (2026-02-27)

### Presence & Tracking
- **Follow mode** — animated room map, movement timeline, multi-device simultaneous tracking
- **Email alerts** on room change (per-device, 60s rate limit, persistent config)
- **Kalman-filtered RSSI smoothing** replacing simple EMA for smoother room transitions
- **Private BLE address resolution** — iBeacon UUID parsing + IRK support for rotating addresses
- **HA entities** — area sensors, distance sensors, device trackers, binary sensors per tracked device
- **Home/away persistence** — binary sensors survive HA restarts
- **Distance estimation** — log-distance path-loss model with configurable reference power and exponent

### Floor Plans & Maps
- **Floor plan editor** — upload PNG/JPG, draw room boundary polygons over blueprints
- **3D isometric multi-floor visualization** with live object positions and room labels
- **Scanner markers** — drag-and-place with 3-digit radio short IDs
- **Stale radio detection** — auto-detect and flag radios no longer in your BLE network
- **Scanner network info** — WiFi SSID, IP address, connection type

### Calibration
- **Full calibration system** — walk-around fingerprint collection with standalone phone panel
- **k-NN fingerprint matching** + **OLS path-loss model** fitting per scanner
- **Coverage heatmap** with guided next-target suggestions
- **Leave-one-out cross-validation** for model quality scoring
- **3D isometric tune view** with draggable receiver markers

### UI & Experience
- **21 dedicated views** across Basic and Advanced modes
- **Training Hub** with guided walkthroughs
- **Sample mode** — fully functional demo with synthetic data
- **11 languages** — EN, ES, FR, DE, IT, PT, NL, ZH, JA, KO, RU
- **Dark forest-green theme** designed for ambient displays
- **Object tagging** — label BLE devices with friendly names, OUI vendor lookup

### Backend
- **DataUpdateCoordinator** polling live BLE snapshot every 10s
- **WebSocket API** for all frontend communication
- **Persistent stores** for settings, maps, objects, calibration, and alert configs

---

## 0.4.x — Foundation (2026-02)

### Added
- Initial integration scaffold with config flow
- Basic BLE scanning via HA Bluetooth component
- Live snapshot with radios and advertisements
- Objects inventory with deduplication and OUI frequency badges
- Vendor lookup via MACVendors + MACLookup APIs (cached 30 days)
- Packaging for HACS (icons, install path, cache-busting)
