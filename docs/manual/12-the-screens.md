# 12. The screens

[Contents](README.md)

What each of PadSpan's screens is for, where it is in the menu, and the everyday ones in more
detail: Overview, Live Tracker, Follow, Occupancy, Traceback, Forensics and Health. Most screens and
cards have their own **?** help beside the heading, in English, German, French and Dutch.

## Finding your way

- **The menu** is down the left side. On a phone it is a bar along the bottom, and **More** opens
  the whole menu.
- **The mode button**, top right (on a phone, in the bar at the top), reads **Basic**, **Advanced**
  or **Dev**. Each press moves to the next mode. This browser remembers your choice.
- **The Data button**, beside it, shows **Live** (your house) or **Sample** (the sample house). See
  [The sample house](#the-sample-house).
- **The status dot**, in the top bar, shows only when something needs a look. See [Health](#health).

## Basic, Advanced and Development

Every screen is in the menu in every mode. The mode decides two things: which screens are in the
**main list** (the rest are under **More tools** at the bottom of the menu, closed until you open
it), and how much detail each screen shows.

- **Basic**: a short main list, and each screen keeps to the essentials. For anyone at home who just
  wants to see where things are. A link to part of an expert screen (a room's outline, a receiver's
  place, the floor heights) opens just that part, with a way back, and the mode stays Basic.
- **Advanced**: the default. A longer main list, and every tool on each screen.
- **Development**: the same menu as Advanced, with more diagnostic detail inside the screens. Use it
  when troubleshooting, or when support asks.

Changing the mode deletes nothing. In Advanced and Development, **Settings → UI Structure** can move
Devices, Bluetooth, Presence, Monitor, QA or Sandbox from More tools into the main list.

## The menu map

Every screen, where it is in each mode, and its heading in the menu. The headings show with the 2025
panel style (the default, **Settings → Appearance → Panel Style**); in Basic, and with the Classic
style, the menu has no headings. A PadSpan Bright install shows only its lighting screens.

<!-- generated:menu (scripts/build_manual_reference.py) -->
| Screen | What it is | In the menu | Basic | Advanced and Development | Heading |
|---|---|---|---|---|---|
| **Overview** | Where everyone and everything is now, on a drawing of your house; before any room is drawn, Who's where now. | Always | Main list | Main list | Live |
| **Live Tracker** | The live map on its own, full screen, for a wall tablet or a second screen. | Always | More tools | Main list | Live |
| **Follow** | One person or thing: its room now, its movements, Locate (Pro) and alerts when it moves. | Always | Main list | Main list | Live |
| **Occupancy** | How many people are in the building, and how the number was reached. | Always | More tools | Main list | Live |
| **Guests** | Guest tags: who is staying now, the tags you lend, and past stays. | While guest tags are on (Settings → Tracking → Phones and guest tags) | Main list | Main list | Live |
| **Setup** | The steps from a floor plan to a calibrated map, in order. | Until every step is done, or setup is skipped | Main list | Main list | Build |
| **Mapping** | Floor plans, their scale, rooms, receivers, floors, and the Atlas builder. | Always | Main list | Main list | Build |
| **Rooms** | Every room's settings in one place: colour, outline, ceiling height, receivers, who is in it. | Always | Main list | Main list | Build |
| **Receivers** | Every receiver in one table: room, floor, height, signal adjustment, status. | Always | Main list | Main list | Build |
| **Calibration** | Teach PadSpan what each spot sounds like, and see how accurate it is. | Always | Main list | Main list | Build |
| **Training** | Animated walkthroughs and the Full Manual, inside the panel. | Always | Main list | Main list | Build |
| **Manage** | Data clean-ups, backups, Home Assistant entities, alerts by email or phone, logs, Factory Reset. | Always | More tools | Main list | Build |
| **Settings** | Every setting, in tabs. | Always | Main list | Main list | Build |
| **Traceback** | Replay where devices went, with Insights (time in each room) and Busy Times (Pro). | Always | More tools | Main list | Diagnose |
| **Health** | Is PadSpan working? Its own checks, receivers' health, and Problems found. | Always | More tools | Main list | Diagnose |
| **Wi-Fi coverage** | A test: how strongly your Wi-Fi access points hear each part of the house, from UniFi Utopia. | While UniFi Utopia's Wi-Fi survey answers | More tools | More tools | Diagnose |
| **Forensics** | Pro: which Bluetooth devices were near your receivers between two times. | While Forensics is on (Settings → Features → Forensics) | Main list | Main list | Diagnose |
| **Monitor** | What PadSpan hears, in numbers, and Export for support. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Diagnose |
| **Devices** | Every device PadSpan tracks or hears, in four lists, and the device registry. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Internals |
| **Bluetooth** | What each receiver hears, and the IRK Manager for phones and watches. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Internals |
| **Presence** | For experts: which rooms each device has been seen in, and what each receiver hears. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Internals |
| **QA** | Checks on your setup, backups, and each receiver ranked. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Internals |
| **Sandbox** | A look under the hood at the live data; changes nothing. | Always | More tools | More tools (Settings → UI Structure can move it to the main list) | Internals |
| **Install Base** | The developer's screen for the opt-in usage reports; asks for a PIN. | Always | More tools | More tools | Internals |

On a phone, the bar along the bottom has Follow, Overview, Mapping and Settings in Basic, and Follow, Overview, Mapping and Calibration in Advanced and Development, then More, which opens the whole menu.
<!-- /generated:menu -->

## The sample house

The sample house is a made-up house on three floors with every feature set up, so you can see what
PadSpan does before your own setup is finished. It is read-only: anything that would change it is
refused with a message, and nothing you do there touches your own house. Only how the panel looks
(its theme and style) can be changed there.

- A new install starts on the sample house and switches to your own by itself once PadSpan hears
  your first receiver.
- **Preview a finished house**, on the Overview's **Who's where now** card, opens it.
- **The Data button**: from Live, the first press turns it into **Show demo data?**; press again
  within 3 seconds to open the sample house. From Sample, one press goes back to Live.
- **Back to my house**, on the yellow banner, goes back to your own.

Live or Sample is this browser's own choice: someone previewing the sample house doesn't switch a
wall screen or anyone else's browser. If the house itself is still set to Sample and Enhanced
security is on, only an administrator can switch it back to Live.

## Overview

The first page: where everyone and everything is now. In Live mode it updates every 5 seconds.

What you see depends on how far setup has got:

- **No room drawn yet**: **Who's where now**, each room and who is in it, from your receivers' Home
  Assistant areas ([chapter 4](04-first-room.md)), and a **Make it a map (optional)** card with
  Setup's steps.
- **Rooms on the map**: the map, a 3D stack of your floors. Each room has its own colour.
  Receivers are rings with a short name, green when reporting and grey when offline. Devices you
  follow are amber markers with their name and how sure PadSpan is of the spot ("Room only" when it
  knows the room but not the spot); they dim and say "(Away)" when away. Turn on **Pins** to show
  your other named devices too.

**Basic** keeps it short: the **Quiet** tick, counts of rooms, objects, receivers and calibration
points, the **Track Your Phone** card, and the map under **Your home**.

**Advanced and Development** add **People in building** (click it to see how the number was
reached) and, under the map, cards for Rooms, Objects, Bluetooth radios and Calibration. Their
buttons open full lists: **View rooms list**, **All objects** and **Unidentified**, **View radios
list**. Click a row for its details. **Clear unidentified** removes devices nobody has named or
followed; they come back if heard again.

**Quiet**, top right, hides devices nobody has named or followed, here and on the other screens. It
changes what is shown, not what is tracked.

Other cards come and go: **Getting started** while setup isn't done, **Improve accuracy** with a
last tip or two once it is, the Pro trial, what changed after an update, and **Positioning
Diagnostics** (folded) for support. With PadSpan Pro, **Settings → Atlas → Show the Atlas as
Overview** puts the Atlas here instead.

## Live Tracker

The live map on its own, as large as the screen allows: good for a wall tablet or a second screen.

- Drag to move the map; the mouse wheel or a pinch zooms; **+**, **−** and **⌂** in the corner do
  the same, and ⌂ resets the view. **Search objects, rooms, scanners…** finds one and moves the map
  to it.
- Top left: counts of rooms, named devices (Tracked) and receivers (Radios). Top right: your
  receivers, each with how many devices it hears; red means it isn't scanning.
- When a device changes room, it shows briefly on the map and in a short list of recent moves.
- Below the map, **Tracked Devices** lists the devices you follow and their rooms; the target icon
  centres the map on one. **ℹ** hides or shows these panels.
- **Controls** opens the drawing controls (the floor, the gap between floors, walls, trails, pins,
  heat), as on the Overview's map.

For a wall screen, open it with `?view=purelive&kiosk=1` on the end of the panel's address: the
panel's menus are hidden.

## Follow

Where one person or thing is right now: a phone, a key fob, a tag, anything Bluetooth PadSpan hears.

1. Pick it under **Choose a tag to follow**: click the search box, or type part of a name, room or
   address. The list is sorted by signal, strongest first. Picking one also adds it to your
   followed devices, so the Overview draws it as an amber marker.
2. The card below says which room it is in now, its floor, and when a receiver last heard it. A
   **Calibrated** badge with a percentage shows when its place comes from your calibration points.
3. The **Location map** draws every room as a box, the tag a pulsing dot in its room. It is a room
   diagram, not your floor plan.

**Name this tag** (or **Rename**) gives it a name. **Details →** opens everything PadSpan knows
about it. In Advanced and Development, the card also lists the receivers that hear it, and a
**Movement log** card its recent room changes.

Under the card:

- **📍 Locate** (PadSpan Pro): which way to walk to find it. Under **You are carrying:**, pick your
  own phone. In the same room, it shows the distance in metres, getting closer or further. In
  another room, it says which room to head to next, and up or down a floor. No compass, no camera.
- **Movement Alerts**: tell you when it changes room, arrives or leaves, on your phone or by email.
  See [chapter 13](13-alerts.md).

## Occupancy

How many **people** are in the building, never how many devices.

- **Known people** come from your Home Assistant person entities.
- **Unknown people** come from phones nobody has claimed, and from rooms whose occupancy or motion
  sensors say someone is there when no known person is.
- **Things** (keys, tags) are listed under **Seen, not people**, and never counted.

At the top: the count, a range when it isn't sure, how confident it is, and the counts behind it.
**Counted** lists each person and how they were found; **Rooms with evidence** and **How the number
was reached** show the working.

- **Hybrid counting** also uses person entities and occupancy and motion sensors; untick it to count
  phones only.
- **Phone clustering**: phones heard at nearly the same strength by every receiver count as one
  person (a phone and its watch). **Save & Refresh** applies a new threshold.
- **Record the real count**: type how many people are really there and **Save**. The **Accuracy**
  card then shows how often PadSpan's estimate and the real count agree.

The same number is the **People in building** card on the Overview.

## Traceback

A replay of where your devices went. About every 10 seconds PadSpan records where each device you
have named or follow is; unnamed devices aren't recorded. It keeps 7 days.

The row at the top switches between four modes:

- **Playback**: pick the **Time range** (5 minutes to 7 days, or a custom range) and **All objects**
  or one device. **▶** plays the whole period; **Run time** (1 to 60 minutes) is how long the replay
  takes. Step a frame, jump to the start or end, or drag the timeline. Each device is drawn where
  live tracking placed it at that moment, or at the centre of its room when there was no position.
  **Export CSV** and **Export JSON** save the frames.
  - **Full house activity** (PadSpan Pro) plays the same back on your Atlas, and with **💡 Devices**
    on, the house too: lights, locks, motion, doors and windows, and sensor readings, from Home
    Assistant's recorder.
- **New Objects**: which devices were first heard in a window (up to 7 days back).
- **Insights**: two tables for the last 1, 3 or 7 days. **Time in Room**: how long each device spent
  in each room each day, and how many times it went in. **Peak Concurrent Occupancy**: the most
  tracked devices in one room at once, each day, and when.
- **Busy Times** (PadSpan Pro): one box per room, busiest first, each with a 24-hour bar chart of
  when it gets busy.

Insights and Busy Times work without a floor plan. **Manage → History → Open History** has the
saved list of room changes, each with **▶ Traceback** to play that moment back.

## Forensics

Which Bluetooth devices were near your receivers between two times: after a break-in or a package
theft, or to spot an unknown tracker that keeps coming back. It is a PadSpan Pro feature, and off
until you turn it on.

**Turn it on**: **Settings → Features → Forensics → Enable presence-session recording**. It asks you
to confirm. While it is on, PadSpan checks every 60 seconds which devices it hears and records
**presence sessions**: stretches of time a device was heard. More than 5 minutes of silence ends a
session. Forensics is then in the main list in every mode.

**Search**: pick a start and an end (local times), or **Last hour**, **Last 24 h** or **Last 7
days**, then **Search window**.

- **Recorded — actually present**: the devices with a session in the window, the longest stay
  first, with their time in the window (Dwell), strongest signal and the receivers that heard them.
- **Hide my labelled devices** hides the ones you named, so strangers stand out.
- **Possible** appears only when the window reaches back before recording began.
- **Export CSV** saves the results.

**A Bluetooth address is not a person.** Phones change their address, so most phones show as
one-off addresses; devices with a fixed address (earbuds, trackers, speakers) are what it finds
reliably. Addresses can be faked. Treat results as leads, not proof.

**Privacy**: it records every device nearby, neighbours' and passers-by's included. Recordings stay
in your Home Assistant and are never uploaded. The Settings card keeps them for 7, 14 (the default),
30, 60 or 90 days, even after you turn recording off; **Delete all recorded data** erases them.

## Health

Is PadSpan working? Health gathers PadSpan's own checks in one page. Clicking the status dot opens
it in any mode.

**The status dot** shows only when something is wrong, with how many issues; hover over it for
their names.

- **Red**: PadSpan isn't answering, so live data has stopped; positioning's last update failed; or
  no receiver is reporting.
- **Amber**: a receiver hasn't been heard for over 10 minutes; a receiver hears far fewer devices
  than usual; or learning is paused, so rooms come from live signals alone.

It waits a few seconds before it shows, so one slow moment doesn't make it blink. Receivers you
marked lost, disabled or excluded don't count, and it watches only live data. On a wall screen only
red shows.

On the page:

- **System**: the version, Live or Sample, and how long the last refresh took. **Open Diagnostics**
  is here for support ([chapter 27](27-getting-help.md)).
- **Hearing less than usual**: a receiver hearing far fewer Bluetooth messages than normal for over
  10 minutes while the others are fine. Rooms near it can be wrong; restarting it often helps.
- **Scanner Health**: for each receiver, how often it agrees with the room the others point to
  (**Agreement**) and the same as a figure from 0.5 to 1 (**Reliability**). The figure is shown
  only: a low one doesn't make that receiver count for less.
- **Room and receiver layout**: PadSpan's model of your home in metres, a list of checks that pass
  or fail, and its tools (**Resync Scanners**, **Run Radio Audit**, **Reset Spatial Model** and
  more).
- **Problems found**: automatic checks of the whole setup, most serious first, each marked **Fix
  this**, **Worth fixing** or **Good to know**, with an **Action:** line and a button to the screen
  where you fix it. Under it, **Room mix-ups** lists the room pairs PadSpan keeps moving a device
  between, and **Map Calibration Quality** each plan's calibration error.

[Chapter 26](26-troubleshooting.md) goes from a symptom to the screen to look at.

## The other screens

- **Setup**: [chapter 9](09-setup-the-map.md). **Mapping**: [chapter 9](09-setup-the-map.md); the
  Atlas builder is in the [Atlas guide](../ATLAS_GUIDE.md).
- **Calibration**: [chapter 11](11-calibration.md).
- **Rooms**: each room's colour, outline (with **Edit outline**, or **Put it on the map** for a room
  drawn only on a plan), ceiling height, split level, receivers and who is in it now. Rooms and
  floors are your Home Assistant areas and floors, so their names change in Home Assistant.
- **Receivers**: every receiver with its room, floor, height, signal adjustment and status. Height
  and signal adjustment change right in the table. **Problems only** shows just the ones that need
  attention.
- **Settings**: every setting is in [chapter 20](20-settings-reference.md). In Basic it has no tabs.
- **Manage**: **Data** (clean-ups, deletions, Backup & Restore), **HA Entities**, **Beacon
  Characteristics**, **History**, **Events** (alerts by email or phone), **Logs** and **Factory
  Reset**. See [chapter 22](22-backup-restore-moving.md) and [chapter 13](13-alerts.md).
- **Training**: animated walkthroughs and the Full Manual inside the panel. Some of it is still in
  English only.
- **Guests**: [the Guest tags guide](../GUEST_TAGS_GUIDE.md) and [chapter 13](13-alerts.md).
- **Devices**: **All Devices**, **By Room** (every device with its room and signal, where you name
  devices), **Registry** (PadSpan's fixed ID for each device, to merge duplicates) and **Door
  Openers**.
- **Bluetooth**: who hears what (**Visualisation**), **Advertisements**, **Scanners** (each
  receiver's signal adjustment, exclude, minimum signal), **IRK Manager** (phones' and watches'
  keys) and **ESPHome Configs** (ready-made settings for building a receiver).
- **Monitor**: what PadSpan hears, in numbers, by receiver and by room, and **Export for support**.
- **QA**: checks on your setup, backups, and each receiver ranked.
- **Presence**, **Sandbox**: for experts; they change nothing.
- **Install Base**: the developer's screen for the opt-in usage reports. It asks for a PIN and shows
  nothing about other people's homes.
