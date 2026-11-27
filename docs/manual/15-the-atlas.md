# 15. The Atlas

[Contents](README.md)

The Atlas is PadSpan's device map: your floors and rooms drawn as a plan, with lights, fans, locks,
sensors, doors and windows where they really are. A tap switches a light or a fan; a sensor says
what it reads, and a lock or a linked door opens its card. It was called "Lights" until it grew past
lighting; the filter chip for light fixtures is still called **Lights**.

## Free and Pro

- **Free**: floors, rooms, and each light and device placed where it really is, as a plain marker.
  Tap a marker, or its row, to switch it. Until December 1, 2026, placement is Pro's, and the free
  map shows one marker per light in its room.
- **PadSpan Pro**: shapes, sizes and angles, Fit room, Automorph, Showcase, WLED's Advanced
  controls, Whole house presets, Vacation Mode, and openers built from relays.

**Settings → Features → PadSpan licence** has a one-time 90-day free trial
([chapter 25](25-padspan-pro.md)). PadSpan Bright is the same Atlas on its own, without presence
tracking, with its own Bright Pro key. A Bright Pro key unlocks the placement tools: placement,
shapes and sizes, WLED's Advanced controls, Automorph and Showcase. Whole house presets, Vacation
Mode and the heatmap need PadSpan Pro or their add-on.

Without Pro, an add-on unlocks one part of the Atlas ([chapter 25](25-padspan-pro.md#add-ons)):
**Audio**; **Alarm & security** (Arm and Disarm in the emergency button, the emergency lights test,
and a door's card with its opener and lock); **Climate & air quality** (the heatmap and each room's
thermostats); **Vacation Mode & presets**; the **Looks pack** (Showcase with its themes, the West
Coast Forest and look presets, on the free map: shapes stay Pro's); **Advanced smart lighting**
(power teams that follow the day, sleep and wake you, WLED's Advanced controls, Automorph, Fit room,
Light spread, Scene, Ripple, Hide untouched, fixture shapes with their size and angle, and the type
override; placement stays Pro's until December 1, 2026); and, from December 1, 2026, **Robot vacuum** (the robot on the map and in 3D, with its card).

## Getting there

- **Mapping → Atlas builder**: where you place and edit devices.
- **The Atlas page in Home Assistant's sidebar**: a lighter view of the same map, without the rest
  of PadSpan. It is on by default; **Settings → Atlas → Show the Atlas in the Home Assistant
  sidebar** turns it off.
- **On a wall screen**: [chapter 18](18-wall-screens-and-kiosks.md).

The map needs your floor plans and rooms first: [chapter 9](09-setup-the-map.md).

## Placing devices

1. In **Mapping → Atlas builder**, find the device in the row list. **Queue all unplaced** lines up
   several at once.
2. Drag its pulsing pin onto the floor, or choose **+ Place** and tap the map where it belongs.
3. With PadSpan Pro, set its shape, size and angle in the inspector: a light can be a pendant,
   sconce, strip or chandelier, in real centimetres. Without Pro it is drawn as a plain marker, and
   a shape it already has is kept for when a key comes back.

Lights, fans, locks, and motion, temperature, humidity, air-quality and leak sensors are all placed
the same way.

- A **temperature** marker is tinted by its reading: blue under 20°, red from 20°, bright orange over
  34°. A **humidity** reading shows as a percentage.
- **Motion** looks the same whatever the sensor: a short flash, then a fade the longer it has been
  quiet. Motion stays quiet for a few minutes after Home Assistant restarts.
- **Outdoor gear** (anything whose area is on an Outside floor: a shed, the garden, the drive) has no
  floor of its own on the flat map. Place it on a floor plate, outside the room it sits beside.

**Heights.** Every placed device has a height above its floor, which the 3D house uses. Pick a device
and use its **Height** row: one of the spots offered for its kind (a motion sensor: Corner, Ceiling,
High on the wall; a leak sensor: Floor), centimetres, or **Default**. The **Heights** list shows every
placed device; tick several to set them at once.

## Using the map

- **A tap switches** a light or a fan. On a sensor, a tap says what it reads; on a lock, it opens the
  lock's card. **A hold** (a gold ring fills as you hold), or Shift or Alt with a click, **selects** a
  device for editing. A drag moves it.
- **Devices on top of each other**: hover, or hold a touch, and the box at the top left names
  everything stacked there. **Alt+click** steps through them.
- **A room's sheet**: tap the room's name for every device in it, **All lights on / off**, its fans,
  and a button for each of the room's scenes and scripts in Home Assistant (up to six). Tap a
  floor's badge for the floor's sheet.
- **Find active** scrolls to the first device doing something now (a light on, motion) and points it
  out.
- On a touchscreen, pinch zooms the map, and a pan survives the map's refresh.

## Doors, windows and locks

A door or window marked on a wall ([chapter 10](10-walls-and-signal-loss.md#doors-and-windows-that-open))
shows open or shut from its sensor. **Invert**, next to **Delete** in the wall list, flips a sensor
that reports backwards: if a door shows the wrong state, check that first. A lock on the map shows
its state. A tap doesn't turn it: a tap or a hold opens its card, with **Lock** or **Unlock**, and
**Unlock** asks first.

A door or window can also carry what opens it and what locks it (PadSpan Pro or the Alarm &
security add-on; a Bright Pro key too).
Tick a cover (a garage door, a gate, a blind), switch, button or script on **Devices → Door
Openers**, then link it to the door or window in **Mapping → Atlas builder**, beside its sensor and
its lock. A tap on the door then opens one card: whether it is open or closed, **Open** or **Close**
for a cover (**Trigger** for a switch, button or script), and the lock. A cover linked with no sensor
says open or shut itself.

**Shades** (free): tick **Shades** in the map's **⋯**, in the group "Doors, windows and locks" (on
the classic layout, **Settings → Atlas → Atlas — Mapped Light Control → Shades**, for the whole
house), and each room's sheet gains one row for every blind and shade in the room: how far open
they are, and **Open**, **Stop** and **Close** for all of them at once. It is off until ticked.
Garage doors, gates, doors and any cover linked as a door's opener are never in it; they stay on
their door's card.

## Alarms and the emergency banner

Leak, smoke, gas and carbon monoxide sensors are drawn as a puddle or a round detector, and say
**WET**, **SMOKE**, **GAS** or **CO**, **ALARM** while latched, and **DRY** or **CLEAR** when quiet. When
one goes off, a red ring sweeps through its room, and it stays alarming for 2 days or until someone
resets it, even if the sensor goes quiet. A banner shows it on every PadSpan screen, with its own
**Reset**. Resetting clears PadSpan's memory of the alarm, not the sensor. More in
[chapter 13](13-alerts.md).

## The scene row

Under the map, and in Live Aboard, is a row of tiles: one for each Home Assistant scene that sets a
placed light, and one for each Whole house preset whose lit lights are all on one floor (marked
**Preset**). A tile is a small map of the floor, showing which lights the scene uses. A tap runs it;
when all its lights are already on, a tap turns them off. **+ New scene** and ✎ open Home
Assistant's own scene editor, for an administrator, and never on a wall screen.

## Audio

Tick **Audio** in the map's **⋯** (Show on this screen, in the rail beside the map, and in the 3D
view's own ⋯) and each room's sheet (in 3D, its panel) gains its music and **Room off**. It is off
until a screen ticks it, and each screen (a phone, a wall) has its own tick. Off, the map and the
sheets are exactly as before. **Set up ›** on the same line opens the matching card (below) right
there over the map, ticked or not, for an administrator, on a wall screen too. A room's shades and
thermostats are lines of their own in the same list: **Shades** (free,
[above](#doors-windows-and-locks)) and **Thermostats**
([Climate & air quality](#heatmap-and-thermostats-pro-or-the-climate--air-quality-add-on)).

- **On the map**: a small round speaker badge beside a room's name while one of its players is on,
  struck through while the room's first player is muted. It keeps clear of the name and of the
  room's readings (temperature, humidity, air), so a reading never looks like a volume. Nothing
  while they are all off, and no other new marks. Tap it, or the name, for the room's sheet: a tap
  on the map never changes anything. The 3D view shows the same badge beside the room's name and
  readings (where the names are hidden, beside the readings); a tap on it opens the room's panel,
  which opens below the emergency button, never under it.
- **The sheet**: **Room off (n)** turns off the room's lights and its players, never a lock, a
  shade, a thermostat or a plug, and shows only while something is on. Then the scenes, as before,
  and:
  - **Audio**: a row for each player, named by its system ("Control4 · Great Room", "Denon · Zone
    2"), with whether it is on, off or muted, **Mute**, the volume and ⏻ (that player off), or **On**
    while it is off (never for a Control4 room, whose "on" can start a TV: pick a source instead).
    The volume is a slider for a player that takes a level: the number follows your finger, Home
    Assistant is told at most four times a second and once more when you let go, and nothing
    redraws under your finger. A player that steps (a Control4 room) keeps **−**, the level and **+**,
    beside the slider where it also takes a level: each press moves the level shown at once, 1 in
    100 on a player that steps itself, and quick presses add up.
    Under the row, while something plays: the cover, the title and the artist, with ▶/⏸ (one
    button while Home Assistant says playing or paused, separate ▶ and ⏸ otherwise, as for a
    Control4 room), ⏮ ⏭ and ⏹, and ⏪ ⏩ for a Control4 room whose integration has the
    `control4.media_scan` action. Then:
    - **Source**: up to four as buttons, more as a list with a filter. The current one is marked.
      Picking one starts the room if it was off.
    - **Mode**: the sound mode of a receiver or soundbar. Long lists (Denon's) come in groups:
      Direct, Stereo, Auto, Movie, music, game, Decoders, DSP. **Now:** shows what the receiver is
      decoding.
    - **Sound**: the player's own tone and surround settings, the ones its Home Assistant
      integration makes on the same device and nothing else: bass, treble, balance, loudness, EQ
      bands and mode, the subwoofer, surround level and mode, speech enhancement, dialogue, clear
      voice, night mode, lip sync, the tone mode and the surround decoder, and Denon's Dynamic EQ.
      Sonos, Russound, Yamaha MusicCast, Music Assistant, Xantech and Nuvo players have them;
      Control4, Anthem, Monoprice and HEOS players have none, so no **Sound** button.
    - **Share**: the rooms whose players can group with this one (the same system, and grouping in
      Home Assistant: Sonos, Music Assistant, HEOS, MusicCast, WiiM, Bluesound...). Tick a room and
      it plays what this room plays, with its own volume; untick it, or **Leave group**. The row
      says "with Kitchen, Den" while it's grouped.

    What a player can't do is left out or greyed: a player that is off shows its level as —.
    **All audio off**, after the players, turns off whatever is playing in every room, after
    asking: a player that can't be turned off is paused, else stopped, else muted. Players that are
    paused or idle are left as they are.
  - the room's lights, as before.

  Each press is one call to Home Assistant, with no question first. Anyone who can switch the lights
  can use them, on a wall screen too. If Home Assistant refuses, it says why in its own words.
- **Matching the players to the rooms**: Home Assistant doesn't know which room a whole-house
  system's zone is in, so an administrator matches them once. **Match rooms** at the end of the
  Audio part (**Match Control4 to HA** where Control4 is the only system) opens a card with every
  player, by system, and a room for each, or **Not on the map**. The first time, it guesses from the
  player's Home Assistant area, else from its name. **Set up ›** on the **Audio** line in **⋯** opens
  it too, and ticking **Audio** with nothing matched opens it at once. Several players can share a room (a Control4 zone and a Denon zone, say): ▲ and
  ▼ set their order, and the first is the one the map's speaker follows. Every pick is kept the
  moment it's made (the card's guesses too, the first time it opens), so there is no Save: **Done**
  closes it. Once it has kept a pick it never guesses again, so players taken off the map stay off,
  and a match to a player Home Assistant doesn't show right now (hidden, not loaded yet) or to a
  room renamed on the map is kept as it was. Someone who isn't an administrator sees the button
  greyed. Each player on the card also has **Sources** (rename a source, hide it, move it up or
  down; Home Assistant keeps its own names) and **Volume limit** (10 % to 100 %, or none), kept
  wherever its volume is set: the slider stops there, **+** stops there, and **Share** keeps it.
- **Which players**: Control4, Crestron, Savant, Savant Audio, Russound, Nuvo, Monoprice, Xantech,
  Triad, Denon, Yamaha and Anthem, by the Home Assistant integration they come from. **Include Home
  Assistant speakers** on the matching card (off unless ticked) adds every other player with a
  volume: Music Assistant, ESPHome, Cast, TVs.

Audio needs PadSpan Pro or the Audio add-on. The **⋯** list is part of the new layout, PadSpan
Pro's and a wall screen's; on the classic layout, **Settings → Atlas → Atlas — Mapped Light Control → Audio** (off by
default, shown where Audio is allowed) does the same for the whole house: the speaker beside a
playing room's name, in the 3D view too, and the sheet's Audio with **Match rooms**. It is the one
switch there: the 3D view's **⋯** has no Audio line of its own.

## Heatmap and thermostats (Pro or the Climate & air quality add-on)

**Settings → Atlas → Atlas — Mapped Light Control → Heatmap chip on the Atlas (temperature,
humidity, CO₂)**, off by default, adds a **♨ Heatmap** chip to the Atlas. Tap it to step through
**Temperature**, **Humidity** and **CO₂** (the kinds your house has a sensor for), then off. Each
room is coloured from its own sensors: the placed ones, or, with none placed, the average of the
room's sensors at its centre. Nothing crosses a wall, a room with no sensor stays uncoloured, and a
reading over an hour old isn't used.

**Thermostats**: tick **Thermostats** in the map's **⋯**, in the group "Motion and sensors" (on the
classic layout, **Settings → Atlas → Atlas — Mapped Light Control → Thermostats**, for the whole
house), and each room's sheet gains each of its thermostats: its temperature now, its mode, and its
setpoint with − and +. The line under the room's name with its temperature and humidity (the middle
reading of its sensors) comes with them. It is off until ticked. Each press is one call to Home
Assistant, as in Audio. The temperature, humidity and air chips under room names stay free.

## Power teams

Smart colour bulbs in sockets fed by a wall dimmer or switch (Zigbee bulbs on a Control4 dimmer, say)
go dark when someone turns the wall off, and come back in the wrong colour. A power team makes the
dimmer and its bulbs one light in Home Assistant. Making, changing and removing a team, and following
the day, Sleep, the bedtime, the night light and the wake-up, need PadSpan Pro (or Bright Pro) or the
Advanced smart lighting add-on ([chapter 25](25-padspan-pro.md#add-ons)); PadSpan Bright has no
power teams, since it gives Home Assistant no entities.

**Without the add-on**, a team already made keeps working as one light: on, off, dimming, its
**Cut power** and **Power on**, each bulb and **Try again**. It doesn't follow the day, sleep or wake
you, and nobody can change or remove it; Settings shows it as it is and offers the add-on. A wake-up
or bedtime already fading when the licence ends finishes the fade it had started on the bulbs, then
the lights stay as they are. With a key again, the day leads again by itself.

**Make one**: **Settings → Atlas → Power teams**, **+ Add a team**. Name it ("Bedroom lights"), pick
**Power from** (the wall dimmer or switch, or **None: these lights always have power** for colour
lights on their own supply, such as LED strings), tick **Its bulbs**, and **Save**. An administrator
makes and changes teams. Each team is then a light in Home Assistant under its name
(`light.<team>`, [chapter 14](14-home-assistant-reference.md)): give it its room there, then place it
on the map.

**What it does**

- **On** puts the power on at full, sends the bulbs their brightness and colour again while they
  start, and says which bulb never answered.
- **Off** does what you chose for the team: **Turns the bulbs off, power stays on** (they come back
  at once, in the right colour; new teams start on this) or **Cuts the power**.
- **The wall control still works.** PadSpan sees the power come on and sets the bulbs. A dimmer held
  low at the wall sets how bright the bulbs go, while the dimmer itself goes back to full: smart
  bulbs need the whole wave.
- **Follow the day**: cool and bright at midday, warm at sunrise and sunset, dim and warmer through
  the night, moved every minute with a slow fade. Choose a colour or brightness yourself and it stops
  until the team is next turned on, or until you choose **Follow the day** again. **Sleep** is one
  dim, warm setting. The curve's numbers (**Brightest, by day**, **Dimmest, at midnight**,
  **Coolest, at noon**, **Warmest, at sunrise and sunset**, **Sleep: brightness**,
  **Sleep: colour**) are yours to change.
- **A fade** of up to 100 minutes, from an automation: while it fades, the day doesn't move it.

**On the map**, a power team is one thing: place the dimmer, one of its bulbs or the team's light. A
tap switches the team, a drag dims it, and a hold opens its card. A dimmer left on with its bulbs off
shows dark, as the room is. **Show power teams** on the settings card shows them in the list.

**The team's card** says what the team is doing (for example **Off · the power is on, so it comes on
at once**, **Power on: the bulbs are starting**, **On · set by hand**, **Waking up: fading in**), with:

- **Follow the day** and **Sleep**;
- the wall dimmer's **Power**, with **Cut power** and **Power on**;
- each bulb, with **Try again** for one that didn't answer;
- **A tap's off**: what a tap on the map does when the team is on;
- **The day's light**: when this light's day starts and ends: **Sunrise moved by** and
  **Sunset moved by** some minutes, or **Day starts at a fixed time** and **Day ends at a fixed time**
  (a bedroom whose day starts at 6:30 all year);
- a **wake-up**: on the days and at the time you choose (**Full light at**, **Fading in over**), a team
  that is off comes on at its dimmest and warmest and fades to full by then. A team already on is
  left alone. **Save the wake-up**;
- **Advanced: the day's curve**.

An administrator changes the wake-up and the curve (with Pro or the Advanced smart lighting add-on).
The sun curve is adapted from Adaptive Lighting.

## Showcase, Automorph and presets (Pro)

Showcase, its themes, the West Coast Forest and look presets also come with the Looks pack add-on,
on the free map; Whole house presets with the Vacation Mode & presets add-on. Automorph, Fit room,
Light spread, Scene, Ripple and Hide untouched come with the Advanced smart lighting add-on, with
Showcase in its Classic theme as their stage (its themes, the forest and look presets stay the
Looks pack's).

- **Showcase**: 20 themes for the whole map (colour, room edges, glow and light pools together).
  Pick one in the Atlas toolbar under **Presentation**.
- **Automorph**: a soft glow drawn on the map from a fixture out into its room, in a choice of styles
  (toolbar → Automorph). It changes the map's look, not the lights.
- **Look presets** save a whole look (theme, Automorph style, and if you like floor, spacing and
  layout) under a name, and **Apply** brings it back.
- **Whole house presets** remembers the house itself: **Set** keeps every light's and fan's state
  (on or off, brightness, colour, effect, fan speed), and **Apply** puts the whole house back that
  way, after asking. Locks are never included.

## Vacation Mode (Pro or the Vacation Mode & presets add-on)

The first entry in the Whole house presets list. It learns your house's routine from Home
Assistant's history (each light, each day of the week) and keeps switching lights to match, with
some randomness so it doesn't look like a timer, until you turn it off. While it runs, a banner sits
in the middle of the Atlas with an **Energy saving** slider (100% follows the whole routine; lower
lights less at once). Turning it on or off needs an administrator.

- **Turning it off asks first.** Home Assistant then shows who turned it off, when and from where,
  and the same message goes to your Follow alert targets.
- **Turned back on within 3 weeks of a trip**, it carries on with that trip's routine instead of
  learning from the days the house sat empty.
- **Options**, each off until set: **Only after dark**, **Ends** (a date and time; it turns itself
  off and tells you), **Pause while someone is home**, **Bedtime** (lights go off from about then
  until 5 am, moving up to 20 minutes each night), **Longest on**.
- `binary_sensor.padspan_vacation_mode` and the `padspan_ha_vacation_mode` event are in
  [chapter 14](14-home-assistant-reference.md). Restoring a PadSpan backup leaves it as it is.

## Outdoor weather

When it rains or snows, faint rain or snow falls around the house on the Atlas, never over a room.
PadSpan Pro or PadSpan Bright Pro animates it; the free map shows it still. Set it up in
**Settings → Atlas → Atlas — Mapped Light Control → Outdoor weather** (Advanced mode): the switch (on by default), a rain sensor (optional), the
weather entity, the warnings sensor (found by itself) and **Strength** (0.5× to 1.5×).

- **Light rain** when it's wet: a rain sensor decides if you chose one, otherwise the weather entity.
- **Nothing** when an on/off rain sensor reads wet but the weather entity says sunny, clear night or
  partly cloudy: dew and frost wet a rain sensor on clear mornings.
- **The weather entity's answer** when the rain sensor hasn't reported for over 3 hours.
- **Heavy rain** only on a rainfall warning, or when the weather entity says pouring.
- **Snow** when the weather entity says snowy, or at 1 °C or colder. **Heavy snow** only on a
  snowfall warning.

Warnings are found by themselves from Environment Canada, MeteoAlarm, DWD and NINA, and
Météo-France. In the USA, the weatheralerts or nws_alerts custom integrations add them.

## Emergency lighting test

A round red **Test emergency lighting** button at the top right of the map, shown only when PadSpan
finds emergency lights: a Home Assistant group with "emergency" in its name (nested groups too), or
else WLED lights named "emergency". It needs PadSpan Pro or the Alarm & security add-on (a Bright Pro
key keeps it); without either, there is no test, and the button shows only an alarm going off.

- **Tap the red centre**: every emergency light comes on, and it says **Test on — tap to end**. Lights
  already on stay on when it ends.
- **Tap the ring** for the list of emergency lights.
- **Force off** turns every emergency light off, including those on before; it asks for a second tap.
- While a Home Assistant automation with "emergency" in its name runs (a real emergency), the test
  won't switch those lights off under it.
- To hide the button on a screen anyone can tap: **Settings → Atlas → Atlas — Mapped Light Control →
  Show the Test emergency lighting button on the Atlas**.
- **Your house alarm** is inside the button when Home Assistant has an alarm panel: the centre
  becomes its shield in its colour, and the centre and the ring both open one card, the alarm on top
  (with PadSpan Pro, the Alarm & security add-on or Bright Pro, Arm and Disarm, always after a question and with the code when the
  alarm wants one) and the emergency lights below, with **Start test**. A house with an alarm and no
  emergency lights gets the alarm's own button, a plain ring. An alarm going off shows on the button
  on every edition. See [chapter 13](13-alerts.md#your-house-alarm-on-the-emergency-button).

## WLED: Advanced and Exact look (Pro or Bright Pro)

A WLED light's card has **Controls | Advanced**. Advanced is a whole WLED workbench in tabs:
**Layout**, **Effect**, **Presets & playlists**, **LEDs**, **Sync & team**, **Exact look**,
**Settings**, **Backup** and **Info**.

**Exact look** makes a WLED light come on looking the same every time:

1. Set the light as you like it, then on **Exact look** choose **Remember this look** (or
   **Remember team look** for every light in its WLED sync team).
2. On **Sync & team**, under **Who gives this light its instructions**, pick
   **PadSpan (exact look)** instead of **WLED sync**. WLED's own sync is switched off on that device,
   and put back if you switch back.

Only an administrator can change who runs a light.

## Openers, locks and lights from relays (Pro)

Openers and locks also come with the Alarm & security add-on, as does ticking an opener on **Devices
→ Door Openers**; a light from relays stays Pro's.

A garage door, window opener, door strike or light wired to plain relays? **Build an Opener, Lock, or
Light from Relays** (**+ Build an opener, lock, or light from relays** in the Atlas builder's list)
makes it a proper Home Assistant cover, lock or light.

- **Opener**: the open and close relays (two different ones), the travel time for a full open or
  close, and a position sensor if you have one (**Invert** if it reads backwards). Without a sensor,
  the position is remembered from the commands.
- **Lock**: the relay, the unlock pulse and the auto re-lock time, in seconds.
- **Light**: the relay and its pulse.

**Build** makes the script, automation and entity; **Remove** takes them away again.
