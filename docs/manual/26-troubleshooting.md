# 26. Troubleshooting by symptom

[Contents](README.md)

Find the symptom, look where it says first, then work down the causes. The screens are named as the
panel names them; some are under **More tools** at the bottom of the menu (in Basic mode, most of
them are).

Two places help with almost everything:

- **The status dot** in the top bar shows only when something is wrong: amber needs a look, red is
  broken. Hovering over it names the problems; clicking it opens **Health**.
- **Health → Problems found** checks the whole setup for what puts devices in the wrong room, and
  each card ends with an "Action:" line saying what to do.

If none of this helps, [chapter 27](27-getting-help.md) says what to send.

## A device shows the wrong room, or jumps between rooms

**Look first:** the **Receivers** page (is every receiver heard, and in the right room?), then
**Health → Problems found** (a ROOMS MIXED UP card names the two rooms it keeps moving between).

Likely causes, most common first:

1. **A receiver is silent or hearing less.** Rooms near it go wrong until it recovers. See
   [A receiver is silent](#a-receiver-is-silent) below.
2. **A receiver is in the wrong room.** PadSpan places a device in the room of the receiver that hears
   it best, so a receiver given the wrong room sends devices there. Fix it in Overview → **View radios
   list** (Assign or Change), or in Mapping → Edit → Receivers.
3. **Two rooms' receivers hear the device almost the same.** Near a doorway, two receivers can be only
   a few dB apart. Put each receiver well inside its room, nearer the middle than a corner, not in a
   cabinet, behind metal or against an outside wall. A room with no receiver of its own can only be
   told apart with calibration, and less reliably.
4. **No calibration yet, or old calibration.** Calibration corrects the nearest-receiver room. Start
   **🧭 Guided calibration** in Calibration; add points in both rooms near where they meet.
   **Calibration → Model** shows how often PadSpan picks the right room on spots it was not
   calibrated on.
5. **A receiver that reads stronger or weaker than the rest.** Give it a trim in Settings → Tracking →
   Receivers → Receiver signal adjustments (or on the Receivers page).

Then, if it still flickers on a boundary:

- Raise **Room Change Delay** (Settings → Tracking → Rooms and timing; 40 seconds unless you changed
  it). 40 to 60 seconds steadies most boundaries; a longer delay is steadier and slower.
- Turn on **Why This Room (Sensor Attribute)** in the same section. The area sensor then says, in its
  `room_reason` attribute, how many polls voted for the room and why a move was held or kept
  ([chapter 14](14-home-assistant-reference.md)).
- Draw a signal wall between the two rooms in Mapping → Edit if there is a real wall there.

A device that has gone quiet keeps the room it was last in (since 0.38.271): it no longer drifts to
another room, or another floor, on old readings. A pinned beacon reports its room once, and a room
change is never sent twice running. More on how PadSpan keeps rooms steady:
[Why does my phone jump between rooms?](https://padspan.traks.ca/guides/room-flapping/)

## A device goes away too soon, or stays too long

**Look first:** Settings → Tracking → Rooms and timing → **Home/Away Timeout**.

- **`not_home` too soon:** a device unheard for the away timeout (5 minutes unless you changed it)
  reads `not_home`. For a device that is briefly out of range in a thick-walled room, raise it to 10
  to 30 minutes. For keys and tags nobody carries, **Things keep their room** lets them stay in their
  last room for hours instead.
- **`not_home` too late:** lower the timeout. The shortest is 1 minute.
- **The room it was left in:** every tracker and area sensor has `last_room`, which stays after it
  reads `not_home`.

## A device doesn't show up

**Look first:** the **Receivers** page (is any receiver reporting?), then Bluetooth → **Scanners**
(what each one hears).

1. **No receiver is reporting.** The status dot is red. See the next sections.
2. **The device isn't sending, or is out of range.** It has to be within range of at least one
   receiver and advertising over Bluetooth. Wake it, bring it next to a receiver, and look again.
3. **It is there but hidden.** **Quiet Mode** (the Quiet tick at the top of the Overview) hides every
   device nobody has named. Near a street, Overview's All objects is full of strangers' devices:
   change **All statuses** to **Identified**, or search by name.
4. **It changed its address.** Phones, watches and Find My tags change their Bluetooth address, so an
   unnamed one shows as a new device each time. A phone needs its key (next section). For a named
   AirTag or other Find My tag, turn on **MAC Rotation Bridging** in Settings → Features.
5. **An iBeacon splits into several devices.** Your receivers must pass on the whole advertisement
   (company 0x004C with an iBeacon payload). A tracker that changes its own UUID can't be followed
   by it.
6. **No Home Assistant entity for it.** PadSpan makes entities only for devices you named, and only
   the kinds ticked in Manage → HA Entities → Entity Publishing Controls.

## A phone isn't recognised, or shows as many devices

**Look first:** Bluetooth → **IRK Manager**.

- **An iPhone or Apple Watch shows as many unknown devices.** Without its identity key (IRK), every
  address change looks like a new device. Add the key in Bluetooth → IRK Manager → **Add an IRK**;
  **Test only** checks a key without saving it. A key added in PadSpan works at once. One added in Home
  Assistant's Private BLE Device is picked up within five minutes.
- **"The provided IRK does not match any BLE devices that Home Assistant can see."** Wake the phone,
  bring it near a receiver, and try again.
- **"The key does not look like a valid IRK."** Copy the whole key: 32 hex characters, or the base64
  text that ends in "=".
- **An Android phone says "Waiting for signal".** Its Companion app's BLE Transmitter is off. In the
  Home Assistant app on the phone, open Settings → Companion app → Manage sensors → BLE Transmitter
  and switch it on. Make sure the phone's Bluetooth is on, then walk near a receiver.
- **An Android phone says "BLE off".** The command to switch the transmitter on didn't reach the app.
  Switch it on by hand as above; the phone must be connected to your Home Assistant for the command
  to work.
- **An Android phone is heard only right next to a receiver, or disappears after a while.** Its
  transmitter is on its weakest settings, or battery saving has stopped the Companion app. The phone
  guide has the steps: [iPhone, Apple Watch and Android room
  presence](https://padspan.traks.ca/guides/phone-room-presence/).

## A receiver is silent

**Look first:** the **Receivers** page's Status column, and Health. A receiver shows **Silent … min**
(the minutes since it was last heard) once nothing has come from it for over 10 minutes, or
**Hearing less** when it hears far fewer devices than usual while the others are fine.

1. **Restart it.** On ESPHome, also check its version and its Wi-Fi.
2. **Check it is still a receiver in Home Assistant**: Settings → Devices & services → its integration
   (ESPHome, Shelly and so on). A proxy that lost its Bluetooth setting stops reporting.
3. **A passive receiver (Shelly, an ESPHome proxy set to passive) heard only now and then**: turn on
   **Refresh every 5 s for passive proxy scanners** in Settings → Tracking → Receivers.
4. **A receiver you took away for good**: choose **Mark as Lost** in its details, or **Exclude** it in
   Bluetooth → Scanners, so it stops counting as silent. Either keeps what it recorded, and **Restore
   Radio** or **Include** brings it back.

A receiver you marked lost, disabled or excluded never lights the status dot.

## "Room and receiver layout not built yet"

The Overview says this when your floor plans have rooms or receivers on them but PadSpan's map of the
house (in metres) has none: devices are placed by nearest receiver only, and nothing is drawn on the
house.

- Press **Put it on the map** (the last step of Setup, and on each room in Rooms), or in
  Mapping → Layout, **Commit this layout**.
- **Health → Problems found → FLOOR PLAN** says when no plan has its scale set yet: a plan needs its
  scale before anything can be placed in metres.

## The panel isn't updating

**Look first:** the bar at the top of the panel, and the status dot.

- **"PadSpan was updated to v…. This page is still running v…"**: press **Reload**.
- **"This page is v…, but Home Assistant is running PadSpan v…. If you just updated, restart Home
  Assistant."**: restart Home Assistant (Settings → System → Restart), then reload.
- **"Bluetooth feed unavailable"** after a first install: restart Home Assistant fully. Reloading the
  integration isn't enough the first time.
- **A red status dot**: PadSpan isn't answering, positioning stopped, or no receiver is reporting.
  Hover over it to see which; Health has the detail.
- **Changes you made don't show**: hard refresh the page (Ctrl+F5, or Cmd+Shift+R on a Mac). Health →
  System shows the panel's version and build, and Diagnostics → Install Verification compares it with
  Home Assistant's. If they differ, Home Assistant is serving an older copy: look for two copies of
  PadSpan in `custom_components`, remove one, and restart.
- **Mapping has only Library and Upload, or Settings has no tabs**: the panel is in Basic mode. The
  mode button at the top right switches back to Advanced.
- **A button is refused**: uploading a plan, setting the scale, backups and anything that sends data
  out need a Home Assistant administrator, and with Enhanced security on, so does any change to the
  shared setup.

## Alerts aren't sending

**Look first:** **Follow**, the alert settings for that device, and **Send Test**.

1. **Nothing was saved.** Tick what you want to hear about, then **Save**: nothing is active until it
   is saved.
2. **No way to send.** Alerts go out through Home Assistant's notify services. For a phone, the
   Companion app must be set up; for email, a mail integration such as SMTP
   (Settings → Devices & services). **Send Test** says plainly if it couldn't reach your phone or mail
   service.
3. **Too close together.** A device's room alerts are at least 60 seconds apart; a change inside that
   time is not sent on its own.
4. **Arrive and leave alerts come late or early**: they follow the away timeout, as `not_home` does
   (above).
5. **Your own automation never fires**: PadSpan's events fire only for named devices, and
   `padspan_room_change` only for followed devices with Room-change tag events on (Settings →
   Tracking → Home Assistant and integrations → HA Tags Integration). See
   [chapter 14](14-home-assistant-reference.md).

## The 3D house won't start

**Look first:** the Atlas. When Live Aboard can't run, the Atlas shows the flat map instead, and the
**🏠** button says why; tap it to try again.

- **No WebGL, too slow, or the graphics restarted**: the browser or the device can't run the 3D view.
  Try **Quality** low (Settings → Atlas → Live Aboard), another browser, or another device. A wall
  tablet may manage only the flat Atlas.
- **No 3D switch at all**: Live Aboard is off unless **Show Live Aboard on the Atlas** is ticked in
  Settings → Atlas (until December 1, 2026, it is also a Pro feature).
- **A device floats in the wrong place**: set its height in Live Aboard's Edit → Heights, or move it on
  the map.
- **A room's temperature shows "–°"**: its sensor hasn't reported for over an hour.

## Home Assistant runs out of memory, or is slow

**Look first:** how much memory the machine has. Next to a busy street or in a block of flats,
PadSpan hears thousands of passing devices, and on a 2 GB machine Home Assistant has run out of
memory within hours.

1. **On a 2 GB machine**, turn on **Low-memory mode** (Settings → Tracking → Performance). It keeps
   fewer passing devices nobody named. Your named, tagged and followed devices are never dropped.
2. **Keep unnamed devices for less time**: Settings → Tracking → What the panel shows → Object History
   Retention, 1 day (the default).
3. **Several wall screens**: turn on **Optimize for scale** (Settings → Tracking → Performance).
4. **The room work slows Home Assistant**: **CPU Mode** (same section) can hold it to one core.
5. **Move to a machine with more memory**: [chapter 22](22-backup-restore-moving.md) says how, and
   [Minimum requirements](../MINIMUM_REQUIREMENTS.md) has the figures.
