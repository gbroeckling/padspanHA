# Atlas Guide

Atlas is PadSpan's device map — floors and rooms drawn as an isometric plan, with lights, fans, locks, sensors, doors and windows placed where they really are. It used to be called "Lights"; it was renamed once it grew past lighting (see [What's in a name](#whats-in-a-name) below). This guide covers placing and controlling devices on Atlas. For uploading floor plans and drawing room boundaries in the first place, see [Floor Plan Setup](FLOOR_PLAN_SETUP.md).

## Who this is for

Atlas works two ways depending on which PadSpan you installed:

- **[PadSpan HA](https://github.com/gbroeckling/padspanHA)** — Atlas sits alongside BLE presence tracking. Free by default; a **PadSpan Pro** key unlocks placement.
- **[PadSpan Bright](https://github.com/gbroeckling/padspanBright)** — the same Atlas map on its own, no BLE tracking. Free by default; a **PadSpan Bright Pro** key unlocks placement.

Either free tier gets floors, rooms and one marker per light — tap the marker (or its sidebar row) to toggle it. A Pro/Bright Pro key on either install unlocks everything below: real placement, shapes, sensors, Automorph and Showcase. See [Editions](../README.md#editions) in the README for the full breakdown, and **Settings → Features → PadSpan licence** for a one-time 3-month free trial if you don't have a key yet.

## Getting there

Open **Mapping → Atlas**, or turn on the standalone **Atlas** sidebar panel in Settings for a lighter view without the rest of Mapping.

## Placing fixtures

With a Pro/Bright Pro key:

1. Go to **Mapping → Atlas** and find the device in the row list (or the "Queue all unplaced" control if you're placing several at once).
2. Either drag the pulsing pin straight onto the floor plate, or tap **+ Place** to queue it and then tap the map where it belongs.
3. Set shape, size and rotation from the inspector — a light might be a pendant, sconce, strip or chandelier; sizes and angles are in real units (centimetres), not a generic dot.

This works for lights, fans, locks, and motion, temperature, humidity, air-quality and flood sensors — every class placed and moved the same way. A **live temperature reading** tints its marker and digits (blue under 20°, red at 20° and up, bright orange over 34°); a live **humidity** reading shows as a percentage. Motion normalizes across hardware too — a PIR that self-clears in 5 seconds and a radar sensor that holds "on" for 20 minutes both draw the same way: a short flash, then a graduated fade the longer it's been quiet. (Motion also stays quiet for a few minutes right after an HA restart, since a just-restored sensor's last change is the boot moment, not a real trigger.)

**Flood/water-leak alarms latch.** A flood sensor draws nothing while dry; the moment it reports wet, a bright red ring radiates out from its position and sweeps through the room. That alarm then *stays alarming for 2 days, or until someone resets it* — even if the sensor itself goes quiet again in the meantime, since a short burst of wet is still a real leak, not a false alarm to auto-clear. An always-visible **emergency banner** (its own two-click-confirm **Reset** button) shows a latched alarm on every tab, not just Atlas — a leak nobody notices for hours is the actual risk this exists to cover. Resetting only dismisses PadSpan's memory of the trip; it never touches the underlying sensor's real, current state.

**Outdoor gear** — anything whose HA area is on an Outside floor (a shed, the garden, the driveway) doesn't have a floor of its own to draw on. Drop its pin, or queue it and tap the map, on any real floor plate right where it sits *outside* the room it lives beside — that's where it belongs on Atlas, and nothing already saved moves if you're revisiting this after placing it before this existed.

## Doors, windows and locks

Mark a door or window on a wall from the Rooms tab's wall list (or the Atlas map's own door/window tool) and it becomes a real RF barrier, not just a picture:

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

**🌴 Vacation Mode** is the one permanent entry at the top of that same list — it isn't a saved snapshot. Instead it learns your house's own real day-to-day pattern from Home Assistant's own history (per light, per day of the week) and keeps turning lights on and off to match it — randomly, not on a fixed schedule, so it doesn't look mechanical — until you disable it. Turning it on shows a banner at the top of every tab with an **Energy saving** slider: 100% replays the full pattern, lower settings scale down how much comes on at once, so it can double as a lighter-footprint mode as well as an away-from-home one. Requires an administrator account to turn on.

## On a touchscreen or phone

Atlas is tuned for touch, not just a mouse: pinch-zoom is the map's own gesture (it no longer fights the browser's page-zoom for the same pinch), panning survives the map's periodic background refresh instead of resetting to the top-left, and tap targets line up with what's actually drawn on screen — including Automorph's aura, so the tappable area matches the visible glow rather than a small fixed circle at the fixture's anchor.

## What's in a name

Atlas used to be called "Lights" — both the Mapping tab and the standalone sidebar panel. It outgrew that name once motion, temperature, humidity, air-quality, flood, locks and doors joined lighting on the same map, and "Bright" was already taken (that's the name of the licence tier that gates part of this map, and of the separately-distributed PadSpan Bright edition). The device-class filter chip that isolates light fixtures from everything else on the map is still called "Lights" — that's a different, narrower thing keeping its own name.

## Where to go next

- [Getting Started](GETTING_STARTED.md) — if you haven't done the BLE presence onboarding yet
- [Floor Plan Setup](FLOOR_PLAN_SETUP.md) — uploading maps and drawing rooms, before there's anything to place fixtures onto
- The in-app **Training Hub** has animated walkthroughs alongside this guide
- [Editions](../README.md#editions) — what's free vs. what needs a Pro/Bright Pro key
