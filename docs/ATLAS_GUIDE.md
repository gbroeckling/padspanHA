# Atlas Guide

Atlas is PadSpan's device map — floors and rooms drawn as an isometric plan, with lights, fans, locks, sensors, doors and windows placed where they really are. It used to be called "Lights"; it was renamed once it grew past lighting (see [What's in a name](#whats-in-a-name) below). This guide covers placing and controlling devices on Atlas. For uploading floor plans and drawing room boundaries in the first place, see [Floor Plan Setup](FLOOR_PLAN_SETUP.md).

## Who this is for

Atlas works two ways depending on which PadSpan you installed:

- **[PadSpan HA](https://github.com/gbroeckling/padspanHA)** — Atlas sits alongside BLE presence tracking. Free by default; a **PadSpan Pro** key unlocks placement.
- **[PadSpan Bright](https://github.com/gbroeckling/padspanBright)** — the same Atlas map on its own, no BLE tracking. Free by default; a **PadSpan Bright Pro** key unlocks placement.

Either free tier gets floors, rooms and one marker per light — tap the marker (or its sidebar row) to toggle it. A Pro/Bright Pro key on either install unlocks everything below: real placement, shapes, sensors, Automorph and Showcase. See [Editions](../README.md#editions) in the README for the full breakdown, and **Settings → Features → PadSpan licence** for a one-time 90-day free trial if you don't have a key yet (see [PadSpan Pro](PADSPAN_PRO.md)).

## Getting there

Open **Mapping → Atlas**, or the standalone **Atlas** sidebar panel (on by default; Settings turns it off) for a lighter view without the rest of Mapping.

## Placing fixtures

With a Pro/Bright Pro key:

1. Go to **Mapping → Atlas** and find the device in the row list (or the "Queue all unplaced" control if you're placing several at once).
2. Either drag the pulsing pin straight onto the floor plate, or tap **+ Place** to queue it and then tap the map where it belongs.
3. Set shape, size and rotation from the inspector — a light might be a pendant, sconce, strip or chandelier; sizes and angles are in real units (centimetres), not a generic dot.

This works for lights, fans, locks, and motion, temperature, humidity, air-quality and flood sensors — every class placed and moved the same way. A **live temperature reading** tints its marker and digits (blue under 20°, red at 20° and up, bright orange over 34°); a live **humidity** reading shows as a percentage. Motion normalizes across hardware too — a PIR that self-clears in 5 seconds and a radar sensor that holds "on" for 20 minutes both draw the same way: a short flash, then a graduated fade the longer it's been quiet. (Motion also stays quiet for a few minutes right after an HA restart, since a just-restored sensor's last change is the boot moment, not a real trigger.)

**Emergency alarms latch.** The Emergency class is water-leak sensors and, since 0.38.131, smoke, gas and carbon monoxide alarms (Home Assistant's `moisture`, `smoke`, `gas` and `carbon_monoxide` binary sensors). A leak sensor is drawn as a puddle and an alarm as a round detector; each says what it found (**WET**, **SMOKE**, **GAS**, **CO**), **ALARM** while latched, and **DRY** or **CLEAR** when quiet. A smoke alarm's default height (for Live Aboard) is the ceiling, a gas or CO alarm's the wall. Everything below applies to all of them. A flood sensor draws nothing while dry; the moment it reports wet, a bright red ring radiates out from its position and sweeps through the room. That alarm then *stays alarming for 2 days, or until someone resets it* — even if the sensor itself goes quiet again in the meantime, since a short burst of wet is still a real leak, not a false alarm to auto-clear. An always-visible **emergency banner** (its own two-click-confirm **Reset** button) shows a latched alarm on every tab, not just Atlas — a leak nobody notices for hours is the actual risk this exists to cover. Resetting only dismisses PadSpan's memory of the trip; it never touches the underlying sensor's real, current state.

**Outdoor gear** — anything whose HA area is on an Outside floor (a shed, the garden, the driveway) doesn't have a floor of its own to draw on. Drop its pin, or queue it and tap the map, on any real floor plate right where it sits *outside* the room it lives beside — that's where it belongs on Atlas, and nothing already saved moves if you're revisiting this after placing it before this existed.

## Doors, windows and locks

Mark a door or window on a wall from the Layout tab's wall list (or the Atlas map's own door/window tool) and it becomes a real signal wall, not just a picture:

- **Material** sets attenuation — a steel door blocks a BLE signal harder than a hollow-core one.
- **Live open/closed state** draws on the map from the linked binary sensor.
- **Invert** — next to Delete in the wall list — flips the on/off reading for a sensor that reports backwards (some vibration-based door sensors report `state=="on"` as *closed*, not open). If a door on the map seems to show the wrong state, this is the first thing to check.
- Locks placed on the map behave the same as any other fixture — tap to lock/unlock, held state shown live.

## Finding a device buried under another

Fixtures placed close together (a light stacked over a fan, say) can be hard to tap individually:

- Hover the cursor (or hold a touch) over a spot and the **hover HUD**, pinned at the top-left of the map, names everything stacked there as clickable rows.
- **Alt+click** cycles through the stack at that point without needing the HUD's picker.
- A press-and-hold shows a gold ring filling in as you hold, on both room names and device markers — the same visual cue everywhere in Atlas that something is about to select rather than switch.
- A plain tap always **switches** a device (toggles it); a genuine hold, or Shift/Alt, **selects** it for editing. Dragging moves it.

## Automorph

Automorph grows a soft aura from a fixture out into its room — a decorative render mode, on top of whatever the fixture's real position and shape already are. The set of styles is still growing and gets pruned when two styles turn out to look the same at real marker size (ten near-duplicates were retired for six genuinely distinct new ones as of v0.38.47) — open the Automorph picker in-app (toolbar → Automorph) for the current list rather than relying on a name here going stale. A few of the longer-lived styles: **Glow**, **Blueprint**, **Nebula**, **Halo**, **Bloom**.

## Showcase

Showcase is a set of 19 curated visual themes for the whole map — colour, room edges, glow and light-pool style change together, each theme with its own distinct hook (a mandala-poled neon HUD look, a plain white-marble-and-brass "real estate" look, a bioluminescent deep-sea look with no room edges at all, and so on). Pick one from the Atlas toolbar under **Presentation**.

The **presets bar** saves a whole look — Showcase theme, Automorph style, and optionally floor/spacing/layout — under a name you choose, and loads it back later with **Apply**. Older presets saved before layout was included never move your camera when applied.

**Whole House Presets** is a different kind of preset, right beside it: instead of the map's *look*, **Set** remembers every light and fan's real state — on/off, brightness, colour, effect, fan speed — and **Apply** puts the whole house back exactly that way, including turning off anything that was off when it was saved. It asks you to confirm before applying, since it changes every light and fan at once. Locks are never included.

**🌴 Vacation Mode** is the one permanent entry at the top of that same list. It isn't a saved snapshot: it learns your house's own day-to-day routine from Home Assistant's history (per light, per day of the week) and keeps switching lights to match it, with some randomness so it doesn't look like a timer, until you turn it off. While it's on, a banner sits in the middle of both Atlas screens with an **Energy saving** slider (100% follows the full routine; lower settings light less at once). Turning it on or off needs an administrator account.

- **Turning it off asks first.** Disable asks "Turn off Vacation Mode?", with **Turn off** at the far left and **Keep it on** where Disable was, so a stray second tap keeps it on. When it does go off, Home Assistant shows a notification saying when, who, and from which app or browser, and the same message goes to the phones or email your Follow alerts use.
- **Turned back on within 3 weeks of a trip**, it carries on with that trip's routine rather than learning from the days the house sat empty. The banner says "same routine as the last trip".
- **Options** (on the banner, or beside Apply while Vacation Mode is picked), each off until you set it:
  - **Only after dark**: lights go on only after sunset (or a set time after it) and before sunrise.
  - **Ends**: a date and time; it turns itself off then, and tells you.
  - **Pause while someone is home**: anyone in Home Assistant's People at home, and nothing is switched until they leave. Nothing is forced off.
  - **Bedtime**: every light it runs goes off from about then until 5 am; the time moves up to 20 minutes either way each night.
  - **Longest on**: a light it turned on goes off after this long, and stays off as long.
- **For your own automations:** `binary_sensor.padspan_vacation_mode` is on while it runs (its attributes give the start, the end, which routine, the options, whether it's paused, and who last turned it off), and the `padspan_ha_vacation_mode` event fires on every change with `on` and `how`.
- Restoring a PadSpan backup leaves Vacation Mode as it is.

## Outdoor weather

When it's raining or snowing, Atlas shows it: faint rain or snow falls everywhere around the house, never over a room or a floor, and never in the space between two stacked floors (that's inside the house). It's off while it's dry, so most of the time you won't see it. It's in both the Atlas sidebar and Mapping → Atlas. PadSpan Pro and Bright Pro animate it; the free map shows the same weather as a still texture. With the phone or tablet set to reduce motion, it's still there too.

What it shows:

- **Light rain** whenever it's wet. With a rain sensor chosen, that sensor decides. Without one, the weather entity decides (rainy, pouring, snowy, snowy-rainy, hail or lightning-rainy count as wet).
- **Nothing** when an on/off rain sensor reads wet but the weather entity says *sunny*, *clear-night* or *partlycloudy*: dew and frost wet a rain sensor on clear mornings. A rain-rate sensor, a rain gauge, or an on/off sensor a helper makes from one (a template, a threshold or a Bayesian sensor) isn't overruled; what it caught really fell. A shower your weather entity's forecast missed shows no rain.
- **Heavy rain** only when something outside confirms it: a rainfall warning, or the weather entity saying *pouring*. A rain sensor alone only ever shows light rain, and a rain-rate sensor never makes it heavier.
- **Snow** when the weather entity says *snowy* or *snowy-rainy*, or it's 1 °C (34 °F) or colder.
- **Heavy snow** only on a snowfall warning, with a pale rim that builds up around the floors.

Weather warnings are found by themselves from Environment Canada, MeteoAlarm (most of Europe), DWD and NINA (Germany) and Météo-France. In the USA, Home Assistant's own weather service has no warnings; the **weatheralerts** or **nws_alerts** custom integrations add them. The UK and Australia have nothing standard, so there, *pouring* is the only heavy-rain signal. If a sensor stops reporting for a moment (Home Assistant restarting, say), the weather on the map stays as it was for up to 2 minutes instead of blinking off.

Set it up in **Settings → UI Structure** (Advanced mode) **→ Atlas — Mapped Light Control → Outdoor weather**: the on/off switch (on by default), the rain sensor (optional; the list shows only actual rain sensors: an on/off rain sensor, a rain rate, or a rain gauge's latest reading), the weather entity (automatic picks your first one), the warnings sensor (automatic finds them) and **Strength** (0.5× to 1.5×). Each saves as soon as you change it, and Atlas picks it up at its next refresh. A water-leak detector saved as the warnings sensor before PadSpan left them out of that list is ignored (Atlas finds warnings itself), and Settings says so under the list.

## Heights

Every placed device has a height above its floor, used by [Live Aboard](LIVE_ABOARD_GUIDE.md) (the
3D house) to put it where it really is. In **Mapping → Atlas**, pick a device and use its **Height**
row: tap one of the spots offered for its kind (a motion sensor: Corner, Ceiling, High on the
wall…; a leak sensor: Floor), type centimetres, or **Default**. The **Heights** list shows every
placed device with its height (or "default"); tick several and set them all at once. Hovering a
device shows its height ("2.40 m up"). Live Aboard's Edit → Heights sets the same heights.

## Room sheets and scenes

Tap a room's name on the map for its sheet: every device in the room, **All lights on / off**,
fans on / off, and a **▶ button for each of the room's scenes and scripts** in Home Assistant (the
ones in that room's area, up to six). Tap a floor's badge for the floor's sheet.

**◎ Find active** (in the floor and device-type bar) scrolls the map to the first device that's
doing something right now, a light on or motion, and points it out.

## Emergency lighting test

A round red button at the top right of the map, **Test emergency lighting**. It only appears when
PadSpan finds emergency lights: any Home Assistant group with "emergency" in its name (nested groups
included), or else WLED lights named "emergency".

- **Tap the red centre** to start the test: every emergency light comes on. The dial pulses and says
  **Test on — tap to end**; tap again to end it. Lights that were already on before the test stay on.
- **Tap the ring** round it for the list of emergency lights and their controls.
- **Force off** turns off every emergency light, including ones that were on before. It asks for a
  second tap (**Tap again**).
- If a Home Assistant automation with "emergency" in its name is running (a real emergency), the
  test won't switch those lights off under it.
- To hide the button (a screen anyone can tap): **Settings → UI Structure → Atlas — Mapped Light
  Control → Show the Test emergency lighting button on the Atlas**. It saves straight away, no restart.

## WLED: Advanced and Exact look

With PadSpan Pro or Bright Pro, a WLED light's card has **Controls | Advanced**. Advanced is a full
WLED workbench in tabs: **Layout** (segments), **Effect**, **Presets & playlists**, **LEDs**,
**Sync & team**, **Exact look**, **Settings**, **Backup** and **Info**.

**Exact look** makes a WLED light come on looking exactly the same every time:

1. Set the light the way you like it, then on **Exact look** press **Remember this look** (or
   **Remember team look** for every light in its WLED sync team at once).
2. On **Sync & team**, under **Who gives this light its instructions**, pick **PadSpan (exact
   look)** instead of **WLED sync**. PadSpan then sends every setting each time the light turns on.
   WLED's own sync is switched off on that device, and put back if you switch back.

Only an administrator can change who runs a light.

## Openers, locks and lights from relays

Got a garage door, window opener, door strike or light wired to plain relays (a ProDino channel, a
PoE port, any switch or light entity)? **Build an Opener, Lock, or Light from Relays** turns them
into a proper Home Assistant cover, lock or light. Find it in **Mapping → Atlas** (**+ Build an
opener, lock, or light from relays** in the device list) or on the **Devices** page. PadSpan Pro.

- **Opener:** pick the open and close relays (they must be different), the **travel time** for a
  full open or close, and a position sensor if you have one (**Invert** if it reads backwards).
  Without a sensor, the position is remembered from the open and close commands.
- **Lock:** the relay, the **unlock pulse** in seconds, and **auto re-lock after** in seconds.
- **Light:** the relay and its **pulse** in seconds.

**Build** creates the script, automation and entity for you; **Remove** takes them away again.

## On a touchscreen or phone

Atlas is tuned for touch, not just a mouse: pinch-zoom is the map's own gesture (it no longer fights the browser's page-zoom for the same pinch), panning survives the map's periodic background refresh instead of resetting to the top-left, and tap targets line up with what's actually drawn on screen — including Automorph's aura, so the tappable area matches the visible glow rather than a small fixed circle at the fixture's anchor.

## What's in a name

Atlas used to be called "Lights" — both the Mapping tab and the standalone sidebar panel. It outgrew that name once motion, temperature, humidity, air-quality, flood, locks and doors joined lighting on the same map, and "Bright" was already taken (that's the name of the licence tier that gates part of this map, and of the separately-distributed PadSpan Bright edition). The device-class filter chip that isolates light fixtures from everything else on the map is still called "Lights" — that's a different, narrower thing keeping its own name.

## Where to go next

- [Live Aboard Guide](LIVE_ABOARD_GUIDE.md) — the Atlas in 3D (Pro): getting around, motion, the heat map, room scenes, and building doors, windows, heights and strips
- [Getting Started](GETTING_STARTED.md) — if you haven't done the BLE presence onboarding yet
- [Floor Plan Setup](FLOOR_PLAN_SETUP.md) — uploading maps and drawing rooms, before there's anything to place fixtures onto
- [Wall Screen Guide](WALL_SCREEN_GUIDE.md) — the Atlas on a tablet or a screen on the wall
- The in-app **Training Hub** has animated walkthroughs alongside this guide
- [Editions](../README.md#editions) — what's free vs. what needs a Pro/Bright Pro key
