# PadSpan Pro and the add-ons

PadSpan HA is free and open source (GPL v3). The free version needs no key and doesn't run out.
Some features need PadSpan Pro or an add-on, and PadSpan says which where you meet them. Pro
includes every add-on.

**PadSpan Pro** is one key for all of it, on the same install: every light and device placed
exactly where it is, the house in 3D (Live Aboard) with Furnish, wall mode, every add-on, and every
new feature while the key runs, on up to five homes. PadSpan can be as simple or complex as you
need, and the free version works on its own. Pro adds everything below.
**Try all of Pro free for 90 days, no card** ([how](#try-it-free-for-90-days)).

To see it first, open the [demo](https://padspan.traks.ca/demo/). The demo shows PadSpan Pro on a
sample house, in your browser; [this link](https://padspan.traks.ca/demo/?page=atlas3d&kiosk=1)
opens it as a wall screen.

Everything about keys is in **Settings → Features → PadSpan licence** unless it says otherwise.
Starting a trial, entering a key and signing up as a tester need a Home Assistant administrator.

- [What only PadSpan Pro has](#what-only-padspan-pro-has)
- [What else a Pro key includes](#what-else-a-pro-key-includes)
- [Prices](#prices)
- [Try it free for 90 days](#try-it-free-for-90-days)
- [Enter a key](#enter-a-key)
- [One key, five homes](#one-key-five-homes)
- [When a key or a trial ends](#when-a-key-or-a-trial-ends)
- [Get Pro free by testing it](#get-pro-free-by-testing-it)
- [Invites](#invites)
- [Kiosk screens](#kiosk-screens)
- [Just want one thing? The add-ons](#just-want-one-thing-the-add-ons)

## What only PadSpan Pro has

No add-on on sale includes these. Each comes with a Pro key: a year, two years, lifetime, the
trial, a tester's key or an invite's free year.

### Every light and device exactly where it is

**What you see:** each light, fan, lock and sensor (motion, temperature, humidity, air quality,
leak, smoke, gas, CO) at its real spot on your floor plan, in its real shape: a pendant, a sconce, a
strip, a chandelier, at its real width, length and angle in centimetres. A temperature marker takes
the colour of its reading. Motion flashes, then fades the longer it stays quiet. The free map shows
one marker per light, gathered in the middle of its room.

**What you tap:** in **Mapping → Atlas builder**, drag a device's pulsing pin onto the floor, or
press **+ Place** and tap where it belongs. **Queue all unplaced** lines up the rest. The inspector
sets shape, size and angle. **What is this?** says what a light really is (a pot light, a pendant, a
lamp). A device's **Height** row sets how high it hangs, for the 3D house.

Placing your lights brings the map's other tools with it:

- **Automorph**: a soft glow drawn from each fixture out into its room, in 16 styles (Glow,
  Blueprint, Nebula, Halo, Bloom and more). It changes how the map looks, never the lights.
  Atlas toolbar → **Automorph**.
- **Fit room**, **Light spread** (bands showing how far each light reaches) and **Hide untouched**
  (only the lights you've set up).
- **Scene**: four colour layouts across a floor (Sunset, Dusk, Ember, Ocean). **Apply** gives each
  light that's on the colour at its spot. **Ripple** sends a brightness pulse out from where you tap.
- **Rain and snow that move.** The free map draws them still.
- **WLED's Advanced controls**: a WLED light's card gets **Controls | Advanced**, a whole WLED
  workbench (Layout, Effect, Presets & playlists, LEDs, Sync & team, Exact look, Settings, Backup,
  Info). **Exact look** makes a WLED light come on looking the same every time.
- **Showcase**, 20 themes for the whole map, also sold alone in the [Looks pack](#looks-pack).

**Where:** Mapping → Atlas builder, and the Atlas page in Home Assistant's sidebar.
**Needs:** floors and rooms drawn on a plan ([manual chapter 9](manual/09-setup-the-map.md)), and the
devices in Home Assistant. Heights need Live Aboard on. More in the [Atlas Guide](ATLAS_GUIDE.md).

### Live Aboard, the house in 3D

**What you see:** your floors, rooms, walls, doors, windows, lights and sensors as a small house you
can turn, zoom and tap, like looking into a house in The Sims. It's built from the map you already
drew.

- Lights glow in their real colour and brightness and light the floor around them.
- The house darkens with the real sun. With the walls up, the windows of lit rooms glow warm from
  outside at night.
- Rain and snow fall outside the walls, never inside a room. Heavy snow builds up white.
- Each room shows its temperature, humidity or air quality under its name. Motion badges take the
  colour of their age, with a dashed line down to where the sensor really is.
- A leak, smoke, gas or CO alarm rings its room and puts its word over everything. An open window in
  the rain glows blue.
- **Studio** puts the house on a stage under a sky that follows the real sun (day, golden hour,
  dusk, night with stars), with soft light and shadows. **By the sun** gives a screen one look by day
  and another after sunset. Each screen keeps its own.

**What you tap:** drag to turn the house, two fingers to move it, pinch to zoom, double-tap a room to
go to it. **Walls** has Cut (the Sims cutaway), Up, Down, Glass and Roof. The floor stepper shows
one floor or all of them, pulled apart with **⇕ Explode**. Tap a light to switch it, and hold it for
brightness, colour and effects. Tap a sensor for its card. Tap a room's name for its panel: its
devices (each switch with **Undo**), its scenes, and the rest of its Home Assistant area.
**Rooms ▾** flies to any room. **⋯** (Show on this screen) ticks what each screen draws; alarms are
always shown.

**Building it:** **Edit** draws doors, windows and doorways on the walls in 5 cm steps. A door can
follow its sensor or a cover, so it opens and shuts when the real one does. **Strip** lays an LED
strip round a room, along furniture or along a railing. **Heights** puts each device at its real
height. Mezzanines and open edges draw as they are. **✨ Set it up step by step** walks through all
of it.

**Where:** Settings → Atlas → Atlas — Mapped Light Control → Live Aboard → **Show Live Aboard on the
Atlas** (off until you turn it on). Then **🏠** on the Atlas page's left rail, or **Map | Live
Aboard** in Mapping → Atlas builder.
**Needs:** floors and rooms drawn, and a browser that can run WebGL (🏠 says why when it can't). It's
experimental and still changing. More in the [Live Aboard Guide](LIVE_ABOARD_GUIDE.md).

#### Walk through the house at eye height

**Walk** (bottom right; on a narrow screen, in **View ▾**) puts you just inside the front door at
eye height. **W A S D** or the arrow keys walk, a stick does it on a touch screen, and a drag looks
round. Walls, railings, sills and closed doors stop you. A door with a sensor opens when the real one
is open, and stairs take you up and down. **✕ Stop walking** or **Esc** puts the view back.

#### The view flies to the doorbell, a door or an alarm

On the sidebar Atlas and on wall screens, Live Aboard can fly to a doorbell that rings, a door that
opens, a sensor that goes off or an alarm that's triggered. It shows a card saying what happened
(with a camera's snapshot if you picked one) and flies back to its home view after 20 seconds. It can
also fly to a person or tag you pick when they go into a room you pick, at most once every 2 minutes
each. If someone touched the screen in the last 20 seconds, only the card shows.

**Where:** Settings → Atlas → Atlas — Mapped Light Control → Live Aboard → **Fly to when it goes
off** and **Fly to when they arrive** (an administrator picks). **Needs:** the doorbell, door, sensor
or alarm in Home Assistant; a camera is optional. Nothing picked is off.

### Wall mode and the new Atlas layout

**What you see:** open the Atlas page as `/padspan-lights?kiosk=1` on a tablet or a TV and it becomes
a wall. The whole house fits the screen, every floor top to bottom. Home Assistant's sidebar and the
header go. Text and controls grow with the screen (twice the size on 4K), so the map reads from
across the room, and the controls fade 30 seconds after the last touch.

**What you set:** **Settings → Atlas → Wall screens** sizes a wall from the screen, or for its room
(the screen's size and how far away people stand, or a preset: desk monitor, kitchen tablet,
hallway, living-room TV, big TV). It also has **Text size**, **Dim at night**, **Protect against
burn-in**, **Show each floor**, Fully Kiosk support and a portrait setting, and it builds a link for
one screen with its own size.

The **new layout** is the Atlas with a rail beside the map and **⋯** (Show on this screen). There,
each screen (a phone, a wall, a laptop) ticks what it shows: people, Audio, whether a tap switches a
light, and **Edgecut**, which zooms until the rooms fill the screen edge to edge. It's
**Mapping → Atlas builder → ▦ New layout**, on by default with Pro.

**Needs:** the new layout. The screen stays awake while the page is open when Home Assistant is
reached over HTTPS; **Dim at night** needs Home Assistant's Sun. The free version has
`/padspan-ha?kiosk=1`, which hides PadSpan's menu. More in the
[Wall Screen Guide](WALL_SCREEN_GUIDE.md).

### Furnish: furniture, devices and people in 3D

**What you tap:** in **Mapping → Furnish**:

- **Build ▾** has 33 kinds of furniture and device, each with its own sliders: a sofa's seats, a
  bed's size, kitchen base, wall and tall cabinets, a sink, a bath, a washer, a car and its charger,
  and more, plus a plain **Box**.
- **Room sets** furnish a whole room in one tap: Kitchen one wall, Kitchen L-shaped, Bathroom,
  Bedroom, Living room, Dining room or Office. One **Undo** takes the set away.
- **Stairs**: Straight, L, U, 2 or 3 landings; Closed, Open, Treads only or Floating; with rails.
  They open a hole in the floor above.
- **Floors and walls**: tap a room's floor for Wood, Light wood, Tile, Stone, Carpet or Concrete,
  its inside wall colour, one feature wall, and the colour of the floor's outside walls.
- **This is a device…** makes a piece act like its Home Assistant entity: a lamp glows in its light's
  colour, a TV lights up while it plays, a fan's blades turn, a washer shakes while it runs, a robot
  vacuum leaves its dock, a radiator glows while heating, a car shows when it's charging.
- **People & devices**: a figure for each Home Assistant person, from sliders or a photo (only with
  that person's agreement), and **Carries** for the phones and tags they carry. Figures are never
  shared.
- **Library** has furniture other houses shared (off until you turn it on), and **Import** takes a
  Sweet Home 3D file.

**Where:** Mapping → Furnish, in Advanced mode. **Needs:** Live Aboard on. More in the
[Furnish Guide](FURNISH_GUIDE.md).

### The Atlas as your Overview

**What you see:** PadSpan's first tab, Overview, shows the Atlas (and Live Aboard, when it's on)
instead of the classic house map. The classic Overview is then under Live Tracker.
**Where:** **Settings → Atlas → Show the Atlas as Overview**, off by default.

### People and tags on the map

**What you see:** each Home Assistant person where their phone or tag is now. On the flat Atlas it's
a round marker with their initial; in Live Aboard it's their figure, or a soft marker, walking there.
In Live Aboard, tags show with their name and a ring sized by how sure the spot is. Tap one for
where they are and since when.

**Where:** **Show people** and **Show tags & scanners** in Settings → Atlas (an administrator's
switch; with Live Aboard on, they're in its **Views ▾**). A screen can hide people in its **⋯** list.
**Needs:** Bluetooth receivers and tracked phones or tags. **Carries**, in Furnish, says which phones
and tags each person carries.

### Building the house from your plans with an AI

- **Let Claude draw your rooms**, in Setup's Draw the rooms step.
- **Plans** (Live Aboard → Edit → Plans): an AI reads your floor plans for stairs and lights, and you
  accept or refuse each find before anything is kept.
- **Line up plans** and **Rooms from plans**: Claude lines up several plans of one floor, and
  proposes room outlines, doors and windows for the rooms you have.
- **Read stairs off the plans** and **Furniture from a photo**, in Furnish.
- A phone's room scan brings its doors, windows, furniture and stairs into the 3D house, and
  **Furniture from scans** draws that furniture on the flat map.

**Needs:** an AI Task in Home Assistant 2025.8 or newer, picked in **Settings → AI**. Line up plans
and Rooms from plans need Claude Opus 5.5 or newer through Home Assistant's Anthropic integration.
Nothing goes to an AI until you start a read, and a cloud AI gets a copy of what it reads. These are
experimental. More in [manual chapter 19](manual/19-ai-features.md).

## What else a Pro key includes

- **Every add-on:** [Audio](#audio), [Alarm & security](#alarm--security),
  [Wi-Fi coverage](#wi-fi-coverage), [Climate map](#climate-map),
  [Full house activity](#full-house-activity) (listed as Time travel in PadSpan 0.38.300 and
  0.38.301), [Vacation Mode & presets](#vacation-mode--presets), [Looks pack](#looks-pack),
  [Forensics](#forensics) and [Presence insights](#presence-insights).
  A Pro key never needs one.
- **Every new feature while the key runs.** PadSpan gets new releases every week. One purchase covers
  all of it, and buying Pro is what keeps the releases coming.
- **Up to five homes on one key** ([One key, five homes](#one-key-five-homes)).
- **PadSpan Bright:** a Pro key also works in [PadSpan Bright](https://github.com/gbroeckling/padspanBright),
  the lighting half on its own, and opens every lighting tool there.

A PadSpan Bright Pro key (sold until December 15, 2026) gives placement, shapes and sizes, WLED's
Advanced controls, Automorph, Showcase, moving weather and the alarm controls. It doesn't open Live
Aboard, Furnish, wall mode, the Atlas as Overview, people on the map, **What is this?** or Heights,
or the add-ons' other features (Vacation Mode and presets, the Heatmap, Audio, Full house
activity, Wi-Fi coverage, Forensics, Busy Times, Locate and the four panel themes).

## Prices

Buy a key at [padspan.traks.ca/#pro](https://padspan.traks.ca/#pro). Each is one PayPal payment,
the key is emailed to you automatically when it goes through, and nothing renews by itself. Prices
are in Canadian dollars.

- **PadSpan Pro for a year:** $45 CAD, until December 15, 2026.
- **PadSpan Pro for life:** $89 CAD once at the launch price until November 30, 2026, then $168 CAD
  until December 15, 2026. Pay with the email of a key you already have and that key becomes
  lifetime.
- **From December 16, 2026:** after December 15 there's no lifetime. PadSpan gets new releases every
  week, and a one-off price doesn't keep that going, so Pro becomes $85 CAD for two years, or $49 CAD
  a year. Every new PadSpan feature is included while it runs. Two years is one payment, and paying
  with the email of a key you already have adds the two years to it. Lifetime keys already sold stay
  lifetime.
- **A PadSpan Bright Pro key** can be changed over to PadSpan Pro for the rest of its term for
  $12 CAD until December 15, 2026, keeping the same key and the same end date.

Add-on prices are in [their own sections](#just-want-one-thing-the-add-ons).

## Try it free for 90 days

**Start 90-day free trial** gives you all of PadSpan Pro for 90 days, every add-on included. It's on
the licence card. A trial card also shows where you meet a Pro feature, and once on the Overview after
PadSpan has been working in your house for a while.

- No card. One trial per home, and your email is used only to send your key.
- An administrator starts it, on an install with no key, or with only an add-on key.
- The trial needs the **usage report** on (anonymous counts of what is used and what breaks;
  **Settings → Tracking** shows exactly what is sent). With it off, the trial card asks you to turn it
  on in the same step. **The usage report stays on for the whole trial and can't be turned off until
  the trial ends** (or until you enter a bought key).
- An add-on key is kept aside for the trial and comes back by itself when the trial ends. Entering a
  different key during the trial clears the kept add-on key.

A trial or key you already have is not affected. When the trial ends, nothing you set up is deleted,
and it all comes back as you left it when you buy.

## Enter a key

Press **Enter licence key** and paste the key you bought or were sent (`PSPAN-XXXX-XXXX-XXXX-XXXX`).
You'll see **Licence activated**. **Replace licence key** swaps it; **Show licence key** shows it
(administrators only). Once a day PadSpan checks the key, so a refunded or revoked key stops working.

## One key, five homes

One key covers up to five Home Assistants (a cabin, a parent's house, a test install):

- **Homes 1 and 2** always count.
- **With more than two homes**, every home on the key must keep its opt-in usage report on
  (**Settings → Tracking → Help improve PadSpan**), the first two included. A third home can join
  only when every home, the new one too, has the report on.
- If one of them turns the report off, the key drops back to its first two homes after 14 days:
  the first two keep Pro, and the others pick up again at their next check once the report is back
  on. The 14 days add up: turning the report back on briefly doesn't start them again, and they
  start again only after every home has had the report on for 30 days. The licence card says which
  home has it off and by when, and turning the report off on such a key asks first.
- A home on PadSpan before 0.38.160 can't send the report, so it counts as off until it's updated;
  the licence card names it as needing an update.
- A home that hasn't checked in for 45 days frees its place.
- A new or reinstalled Home Assistant can take the place of a home not seen for 14 days.

**Show this key's homes** on the licence card lists them, lets you name this one and remove one you
no longer use. If a home isn't counted, the licence card says why.

An add-on key covers up to three homes, with no usage-report rule.

## When a key or a trial ends

- **14 days' grace.** A key keeps working for 14 days past its end date, and so does each add-on
  past its own. For add-ons, the licence card says how many days are left.
- **Then the paid parts lock again.** Light placement on the Atlas becomes read-only, Forensics
  stops recording, and the 3D house, wall mode, Locate and Busy Times switch off. The other paid
  features lock the same way.
- **Nothing you set up is deleted.** Your placements, your 3D house and your settings are kept, and
  PadSpan still reads and exports everything you built. What Forensics recorded stays searchable
  until its retention time runs out. Renew or buy, and it all comes back as you left it.
- **A trial** ends the same way. The usage report can be turned off again, and an add-on key kept
  aside comes back by itself.
- **A tester's or an invite's free year** goes back to the free version when it ends. Anything you
  made stays.
- **Lifetime keys** don't end.

## Get Pro free by testing it

**Become a tester** (on the licence card, or under **Settings → Tracking → Help improve PadSpan**)
gives you two years of PadSpan Pro free (one year if you join from December 16, 2026). The
anonymous usage report stays on for that time:
it can't be turned off while the key runs (the key needs it on when you enter it). You're
asked for an email and can add what you'd like to test. Before anything is sent you can see exactly
what goes, and **Stop being a tester** withdraws your sign-up at any time. The README's
[Become a tester](../README.md#become-a-tester-separate-from-the-usage-report) section explains
exactly what is sent and kept.

## Invites

Now and then, an install that sends the usage report gets an invite to **a free year of PadSpan
Pro**. It shows on Overview and on the licence card, to administrators only (only an install with the usage report on is ever sent one). The report
stays on for the free year: it can't be turned off while the year runs. The choices:

- **Claim my free year:** enter an email and your key arrives there. No card, nothing renews.
- **Later:** asks again in a week.
- **No thanks:** final; it won't come back.

Nothing is sent unless you press one of those buttons. The website lists the other ways to get a
free year: [padspan.traks.ca/#pro-free](https://padspan.traks.ca/#pro-free).

## Kiosk screens

A screen opened in kiosk mode (`?kiosk=1`, see the [Wall Screen Guide](WALL_SCREEN_GUIDE.md))
never shows trial or invite offers.

## Just want one thing? The add-ons

An add-on adds one feature to an install without Pro. PadSpan Pro includes every one of them.

**The terms, the same for every add-on:**

- One payment covers 2 years. There's no subscription.
- Up to 3 homes. A reinstalled Home Assistant can take the place of a home not seen for 14 days, and
  a home silent for 45 days frees its place.
- One key carries all your add-ons. Buy another with the same email and it joins that key; buy one
  again and it runs on from its own date.
- 14 days' grace past each add-on's own end date.
- Updates are included, and it keeps working when the internet is down, like any key.
- Enter the key in **Settings → Features → PadSpan licence**, like any key. The licence card then lists
  each add-on with its date.
- Add-ons need PadSpan 0.38.300 or later.
- An add-on key is not a Pro key and opens nothing else. You can still try Pro: the 90-day trial keeps
  your add-on key aside and puts it back when the trial ends. Buying Pro with the same email makes
  your add-on key Pro, from that day.

Buy them at [padspan.traks.ca/#addons](https://padspan.traks.ca/#addons). Prices in CAD:

| Add-on | Price | What it adds |
| --- | --- | --- |
| [Audio](#audio) | $6.45 | Each room's players, shades and thermostats in its card on the map, and Room off |
| [Alarm & security](#alarm--security) | $6.45 | Arm and disarm in the emergency button, the emergency lights test, and the door, garage and gate card with its openers and lock (a triggered alarm, locks and Alert pulse stay free) |
| [Wi-Fi coverage](#wi-fi-coverage) | $6.45 | The UniFi Wi-Fi coverage map, with what to fix |
| [Climate map](#climate-map) | $8.65 | The Heatmap: rooms by temperature, humidity and CO₂ |
| [Full house activity](#full-house-activity) | $7.55 | The house played back on the Atlas: people, lights, doors, locks and sensors |
| [Vacation Mode & presets](#vacation-mode--presets) | $4.25 | Vacation Mode and Whole House Presets |
| [Looks pack](#looks-pack) | $4.25 | Day and three more themes, Showcase and the forest |
| [Forensics](#forensics) | $5.56 | Which Bluetooth devices were near a scanner in any time window |
| [Presence insights](#presence-insights) | $5.56 | Busy Times and Locate |
| Advanced map creation (not on sale yet: it comes with the free 3D house) | $8.65 | AI plan reading, reading a photo, a LiDAR scan's doors, windows, furniture and stairs in the 3D house, Furniture from scans, and floor plans from a LiDAR scan (free until it is on sale) |

Where a feature is locked, PadSpan names what opens it: "PadSpan Pro or the … add-on".

### Audio

Turn the kitchen down from the hallway screen, or turn a room off on your way out of it, from the
same card as its lights.

**What it adds**, in each room's card on the Atlas (tap a room's name):

- **A status line**: the room's temperature and humidity (the middle reading of its sensors), beside
  who is there.
- **Room off (n)**: turns off the room's lights and players that are on. It never touches a lock, a
  shade, the thermostat or a plug.
- **Audio**: a row for each player, named by its system ("Control4 · Great Room"), with On, Off or
  Muted, **Mute**, **−**, the level, **+** and **⏻**. Buttons show only for what the player can do.
- **Shades**: one row for all the room's covers, with how far open they are and **Open**, **Stop**
  and **Close** for all of them at once. Garage doors, gates and doors stay on their door's card.
- **Climate**: each thermostat's temperature now, its mode, and its setpoint with **−** and **+**.
- **On the map**: a small speaker beside a room's name while one of its players is on, struck
  through while it's muted. A tap on it opens the room's card; only the card's buttons change
  anything.
- **Match rooms** (an administrator, once): pick the room each player is in. PadSpan guesses from the
  player's Home Assistant area, else its name. Several players can share a room.
- **Include Home Assistant speakers** on that card adds every other player with a volume: Music
  Assistant, ESPHome, Cast, TVs.

**Where:** turn it on in **Settings → Atlas → Atlas — Mapped Light Control → Audio** (off by
default), for the whole house. With Pro's new layout, each screen ticks **Audio** in its **⋯** list
instead, and the 3D house shows it too.
**Needs:** players from Control4, Crestron, Savant, Russound, Nuvo, Monoprice, Xantech, Triad,
Denon, Yamaha or Anthem in Home Assistant (or any player with a volume, with Include Home Assistant
speakers ticked); rooms on the map that are Home Assistant areas; the room's covers and thermostats
in its area.
**Free without it:** the rest of the room's card: lights and fans with All on and All off, the room's
scenes and scripts, who is there, and its locks.
**One limit:** without Pro, Audio is on or off for the whole house. Choosing it screen by screen
needs Pro's new layout.
**Price and terms:** $6.45 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Alarm & security

Arm the alarm from the hallway screen on the way out, or check from bed that the garage is shut.

**What it adds:**

- **Your house alarm inside the emergency button**, top right of the Atlas. The button's centre is
  the alarm's shield, in a colour for its state (grey disarmed, blue armed, amber pending, red going
  off). Press it for the card: **Arm home**, **Arm away**, **Arm night**, **Arm vacation** or **Arm
  custom bypass** (the ones your alarm supports) while it's disarmed, **Disarm** while it's armed.
  Every arm and disarm asks first, with a field for the code when the alarm wants one. PadSpan never
  keeps the code. A wrong code shows Home Assistant's own refusal.
- **The emergency lights test**: the red **Test emergency lighting** button. A tap on the centre
  turns every emergency light on, and a tap again ends it, leaving on the lights that were already
  on. **Force off** turns them all off, after a second tap. The test won't switch lights off under a
  running Home Assistant automation with "emergency" in its name. It was free until PadSpan 0.38.300.
- **The door, garage and gate card**: tap a linked door on the Atlas for one card with its state
  ("Closed & Locked", "Closed, Unlocked", "Open"), **Open** and **Close** for a cover, **Trigger** for
  a relay, button or script, and its lock.
- **Devices → Door Openers**: mark a cover, switch, button or script as what opens a door, then link
  it to the door, with its lock, in Mapping → Atlas builder.
- **Openers and locks built from relays**: a momentary opener (garage door, gate), a two-direction
  opener (a motorized window, a blind, an awning) or a door-strike lock, made into a proper Home
  Assistant cover or lock. A light built from relays stays Pro's.

**Where:** the Atlas page, top right; **Devices → Door Openers**; Mapping → Atlas builder.
**Needs:** for the alarm, an `alarm_control_panel` in Home Assistant (Alarmo, or your alarm system's
own integration). For the test, emergency lights: a Home Assistant group with "emergency" in its
name, or WLED lights named that way. For the door card, a door drawn on a wall with its sensor, and a
cover, switch, button, script or lock to link.
**Free without it:** an alarm going off shows on the button and as a row in the red banner on every
PadSpan screen ("Alarm going off: House · Back door"). Leak, smoke, gas and CO alarms still latch and
ring their room red. Locks lock and unlock on the map and in a room's card. Alert pulse still rings a
room amber when a door is left open. A test already running can always be ended.
**One limit:** arming runs with the login on the screen. Anyone whose Home Assistant login can use
the alarm can arm or disarm it from the Atlas, on a wall screen too.
**Price and terms:** $6.45 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it. A Bright Pro key keeps
these alarm controls too.

### Wi-Fi coverage

When a device keeps dropping off Wi-Fi, see which access point it clings to and which room is weak.

**What it adds:** the **Wi-Fi coverage** tab:

- **A coverage map** per floor and per band, drawn on your rooms, from red (−85 dBm) to green
  (−45 dBm). 2.4 GHz and 5 GHz are separate maps; pick all access points or one to see its reach.
- **A room table**: each room's middle reading, a word for it (excellent to very weak) and how long
  it was measured.
- **What to fix (n)**: UniFi Utopia's findings, most urgent first, each with what to do. A click
  shows it on the plan.
- **Where the access points are** (administrators): each one placed in Mapping, or shown dashed where
  the devices that hear it best suggest. **Place in Mapping** puts it there.
- **Which Wi-Fi device is which phone** (administrators), when the names differ.
- **The robot vacuum's readings**, when it runs room location runs.

**Where:** the Wi-Fi coverage tab, under More tools. It shows only while UniFi Utopia's survey
answers.
**Needs:** [UniFi Utopia](https://github.com/gbroeckling/unifi-utopia) on the same Home Assistant,
with a UniFi controller and UniFi access points. Its Wi-Fi survey is still a test build. Readings come
from phones that sit still for about a minute where PadSpan has them, and from devices placed on the
plan.
**Free without it:** UniFi Utopia's own features. PadSpan's radio maps show Bluetooth, not Wi-Fi.
**One limit:** it fills in over days: the devices within the first hour, the phones over days.
**Price and terms:** $6.45 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Climate map

One look at the wall screen shows which bedroom is cold or which office needs air.

**What it adds:**

- **The ♨ Heatmap chip** on the Atlas. Each tap steps through **Temperature**, **Humidity** and
  **CO₂** (the kinds your house has a sensor for), then off.
- **The colours:** temperature blue below 19 °C, green from 20.5 to 23.5, amber at 25 and red at 28.
  Humidity orange at 20 %, green from 40 to 60, blue at 70. CO₂ green at 400 ppm, yellow at 1,000 and
  red at 1,500. Fahrenheit sensors work too.
- **Each room from its own sensors:** nothing crosses a wall, outdoor rooms are never coloured, and a
  reading over an hour old isn't used.

**Where:** turn it on in **Settings → Atlas → Atlas — Mapped Light Control → Heatmap chip on the
Atlas (temperature, humidity, CO₂)** (off by default). The chip is on the Atlas page and in Mapping →
Atlas builder.
**Needs:** temperature, humidity or CO₂ sensors in the Home Assistant areas that match your rooms.
**Free without it:** a tap on a sensor on the Atlas still says what it reads. Thermostat control in a
room's card is part of [Audio](#audio).
**One limit:** without Pro, sensors aren't placed, so each room takes one colour from the average of
its sensors. With Pro, the colour blends between placed sensors.
**Price and terms:** $8.65 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Full house activity

Back from a day out, play the house back and see who came home when, which door was left open and
whether the lights burned all afternoon.

**What it adds:**

- **The 🏠 Full house activity switch** in **Traceback → Playback**: turn it on and the playback
  moves onto your Atlas, with every tracked person and tag on it, run by Traceback's own play, pause
  and timeline.
- **💡 Devices** (with Full house activity on): every device the Atlas shows plays back through its
  states over the chosen time (lights, doors, locks, motion, temperature, humidity and air), and what
  changed is ringed on the map. Lights Vacation Mode switched are marked as Vacation Mode's.
- Any of Traceback's ranges: 5 minutes to 7 days, or your own.

**Where:** Traceback → Playback.
**Needs:** a floor plan with rooms (Traceback plays on a plan), Bluetooth receivers for people and
tags, and Home Assistant's recorder for devices. People and tags come from Traceback's own 7 days;
devices come from Home Assistant's history, so nothing new is recorded.
**Free without it:** Traceback's own Playback of people and tags, New Objects, Insights, and
**Share a replay** (a 10 to 30 second clip you can post).
**One limit:** without Pro, the add-on plays back the free map, with each light in its room. Placement
puts them where they hang.
**Price and terms:** $7.55 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Vacation Mode & presets

On the way out the door, turn on Vacation Mode and the house keeps its usual evenings while you're
away. At home, a "Movie night" preset puts every light back the way you saved it.

**What it adds:**

- **Whole House Presets**, a **Whole house** bar on the Atlas. **Set** remembers how every light and
  fan is now (on or off, brightness, colour, effect, speed) under a name you type. **Apply** puts the
  whole house back that way, turning off what was off, after a second tap. Locks are never included.
- **🌴 Vacation Mode**, first in that list. It learns each light's routine for each day of the week
  from Home Assistant's history and keeps switching lights to match, with some randomness, until you
  turn it off. Turned back on within 3 weeks of a trip, it carries on with that trip's routine.
- **Its banner**, in the middle of the Atlas while it runs, with an **Energy saving** slider (lower
  lights less at once) and **Disable**, which asks first.
- **Options:** the routine from **Last week** or a **Monthly average**; **Only after dark**; **Ends**
  (a date it turns itself off); **Pause while someone is home**; **Bedtime**; **Longest on**; **Most
  lights on at once**; up to 10 **Evening lights** (a porch or hall light); and **Preview**, which
  shows the next 24 hours and switches nothing.
- **A notice when it stops**: who turned it off, when and from where, to your Follow alert targets.
- **For your automations:** `binary_sensor.padspan_vacation_mode` and the `padspan_ha_vacation_mode`
  event.

**Where:** the Atlas page and Mapping → Atlas builder. On Pro's new layout, the ★ presets drawer.
**Needs:** Home Assistant's recorder history for your lights and fans (Last week needs the 7 days
before the trip). Turning Vacation Mode on or off needs an administrator. It runs lights and fans
only.
**Free without it:** Home Assistant's own scenes and scripts, one tap each in a room's card.
**One limit:** it needs light history to learn from. With none yet it says "Nothing yet: there is no
light history to learn a routine from."
**Price and terms:** $4.25 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Looks pack

For a wall screen that's part of the room, or a light panel by day.

**What it adds:**

- **Four panel themes** in **Settings → Appearance → Theme**: **Graphite**, **Ocean**, **Dusk** and
  **Day** (the whole panel in light colours). **Follow the sun** uses Day while the sun is up.
- **Showcase** on the Atlas: 20 themes for the whole map, each changing colour, room edges, glow and
  light pools together. Atlas toolbar → **Presentation**.
- **The West Coast Forest**, the Showcase theme with trees round the house.
- **The presets bar**: save a whole look under a name, and **Apply** brings it back.

**Where:** Settings → Appearance, and the Atlas toolbar.
**Needs:** nothing else.
**Free without it:** the Night, Light and High contrast themes.
**One limit:** without Pro the lights aren't placed, so Showcase draws them gathered in their rooms.
Automorph and placement stay Pro's. The themes change the main PadSpan panel; the sidebar Atlas page
stays dark with every theme.
**Price and terms:** $4.25 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Forensics

Check which Bluetooth devices were near the house last night after a package went missing, or spot
an unknown tracker that keeps coming back.

**What it adds:**

- **Recording**: **Settings → Features → Forensics → Enable presence-session recording** (it asks you
  to confirm). Every 60 seconds PadSpan notes which devices it hears, as presence sessions; 5 minutes
  of silence ends one.
- **The Forensics tab**: pick a start and an end, or **Last hour**, **Last 24 h** or **Last 7 days**.
  **Recorded — actually present** lists each device with its time in the window, its strongest signal
  and the receivers that heard it. **Possible** adds lower-confidence matches. **Hide my labelled
  devices** lets strangers stand out. **Export CSV** saves the results.
- **Retention** of 7, 14 (the default), 30, 60 or 90 days, and **Delete all recorded data**.

**Where:** Settings → Features, and the Forensics tab in the main list while recording is on.
**Needs:** Bluetooth receivers, and PadSpan's data mode on Live.
**Free without it:** the presence tracking, Traceback and each device's history.
**One limit:** a Bluetooth address is not a person. Phones change their address and addresses can be
faked, so it finds fixed-address devices (earbuds, trackers, speakers) best. Treat results as leads,
not proof. It records neighbours' and passers-by's devices too; recordings stay in your Home
Assistant and are never uploaded.
**Price and terms:** $5.56 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.

### Presence insights

See which rooms the house really uses, and when. Find the keys or the dog's tag, room by room.

**What it adds:**

- **Busy Times** (Traceback → Busy Times): over the last 1, 3 or 7 days, one box per room, busiest
  first, each with a 24-hour bar chart and its busiest hour marked.
- **📍 Locate** (Follow → 📍 Locate): directions to a tag or phone you're looking for. Under **You are
  carrying:**, pick your own phone. In another room it says which room to head to next, and up or
  down a floor. In the same room it shows the distance in metres, getting closer or further.

**Where:** Traceback → Busy Times; Follow → 📍 Locate.
**Needs:** Bluetooth receivers and tracked phones or tags. Locate needs rooms that touch on the map;
Busy Times uses Traceback's 7 days of history.
**Free without it:** the **Insights** mode of Traceback (time in each room, entries and peak
occupancy) and a device's 📍 Locate flash on the map.
**One limit:** Locate gives room-by-room directions, not an arrow, and you pick which device is you.
**Price and terms:** $5.56 CAD, one payment for 2 years on up to 3 homes, on your one add-on key.
No subscription, and 14 days' grace after it ends. PadSpan Pro includes it.
