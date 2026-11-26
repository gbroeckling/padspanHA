# A. Glossary

[Contents](README.md)

The words this manual and PadSpan's panel use, in alphabetical order.

**Add-on.** One part of PadSpan Pro, bought on its own for an install without Pro: Audio, Alarm &
security, Wi-Fi coverage, Climate map, Full house activity, Vacation Mode & presets, Looks pack, Forensics,
Presence insights or Advanced smart lighting, and from December 1, 2026 Advanced map creation or
Robot vacuum. One payment covers 2 years, on up to three homes; PadSpan Pro includes them all. See
[chapter 25](25-padspan-pro.md#add-ons).

**Administrator.** A Home Assistant user with administrator rights. Backups, restores, a Factory
Reset, phones' keys, floor plan uploads and anything that sends data out of the house need one; with
Enhanced security on, so does every change to PadSpan's shared setup.

**Advertisement.** A short Bluetooth message a phone, tag or beacon sends out over and over. Receivers
hear advertisements; PadSpan never connects to the device.

**Advanced, Basic and Development.** The panel's three modes, switched by the mode button at the top
right. Every screen is in the menu in every mode; the mode decides which are in the main list (the
rest are under **More tools**) and how much detail each screen shows. Settings has only Appearance
in Basic.

**Area.** A Home Assistant area (Settings → Areas, labels & zones). Normally a room in PadSpan is a
Home Assistant area, and its name is the room's name everywhere. (Set to Standalone, in Settings →
Tracking → Home Assistant and integrations → Room and receiver layout source, PadSpan uses rooms
drawn in PadSpan and no areas at all.)

**Atlas.** PadSpan's map of the house for everyday light control, in the sidebar as **Atlas**, built
in Mapping → Atlas builder.

**Away timeout.** How long a device goes unheard before it reads `not_home` (5 minutes unless you
change it, in Settings → Tracking → Rooms and timing → Home/Away Timeout).

**Backup.** Here, either PadSpan's own (Manage → Data → Backup & Restore, kept on the machine) or
Home Assistant's (Settings → System → Backups, which carries PadSpan's files). See
[chapter 22](22-backup-restore-moving.md).

**Beacon.** A small device that only advertises: a tag, an iBeacon, a Find My tag. A **pinned
beacon** is one you placed on the map at a fixed spot (Calibration → Beacon Tune), which can add
calibration points by itself.

**BLE.** Bluetooth Low Energy, the kind of Bluetooth phones, watches and tags advertise with.

**BLE Transmitter.** A sensor in the Android Home Assistant Companion app that makes the phone send
an iBeacon with a fixed id, so PadSpan can follow it without a key.

**Bluetooth proxy, scanner.** Other names for a **receiver**. "Bluetooth proxy" is ESPHome's and Home
Assistant's word; older parts of PadSpan say "scanner".

**Calibration point.** A spot in a room where you stood with a device while PadSpan recorded what
every receiver heard, and how loudly. With enough of them PadSpan can tell rooms apart that sound
alike to the nearest receiver. Made in Calibration (**🧭 Guided calibration**, Pin & Listen, Beacon
Tune, or Walk a room).

**Commit this layout.** The button in Mapping → Layout that puts the rooms and receivers drawn on a
floor plan onto the map of the house, as **Put it on the map** does.

**Consensus.** The room most of the recent polls agree on. A new room has to win a vote of several
polls (set by Room Change Delay) before a device moves there, so one loud reading doesn't move it.
Receivers are judged against it in Health ("Agreement").

**dBm.** The unit of signal strength (RSSI). Closer to zero is louder: -55 dBm is near, -90 dBm far.

**Device.** Here, anything Bluetooth PadSpan hears: a phone, a watch, a tag, a beacon, a neighbour's
earbuds. Also Home Assistant's word for one thing with its entities.

**Diagnostics.** PadSpan's report for support (QA → Go to Diagnostics). Home Assistant's own
**Download diagnostics** is a different, much shorter report. See [chapter 27](27-getting-help.md).

**Edition.** Which download is installed: **PadSpan HA** (presence, maps and the Atlas) or **PadSpan
Bright** (the Atlas alone, for light control without presence).

**Enhanced security.** Settings → Tracking → Privacy, updates and feedback → Enhanced security. When
on, only an administrator can change PadSpan's shared setup; everyone can still view and use it. On
for a new install.

**Entity.** One thing Home Assistant can show and automate: a tracker, a sensor, a light. PadSpan's
are listed in [chapter 14](14-home-assistant-reference.md).

**Export for support.** Monitor → Export for support: the Diagnostics report plus what the receivers
hear right now.

**Fabric.** PadSpan's map of the house in metres: each floor, its rooms' outlines, its walls, where
each receiver and light is. Floor plan pictures are placed over it; positions are always worked out
in it, never from the picture. Health calls it the **Room and receiver layout**.

**Factory Reset.** Manage → Factory Reset: empties PadSpan's files, including its own backups, and
starts it as new. It keeps your licence key.

**Find My tag.** An AirTag or another tag that works with Apple's Find My. It changes its address,
every 15 minutes near its owner and once a day away.

**Fingerprint.** What every receiver heard at a calibration point. PadSpan matches a device's live
readings to the nearest fingerprints. In a house with a map, the position worked out from the
receivers decides the room first ([chapter 11](11-calibration.md)).

**Floor.** A Home Assistant floor (Settings → Areas, labels & zones). Each floor can have floor plans
and its own height.

**Floor plan.** A picture of a floor, uploaded in Mapping (or made from a blank floor, a phone's room
scan or a robot vacuum's map). Once its **scale** is set (a measured length on it), things drawn on it
can go onto the map of the house.

**Follow, followed.** Following a device (on the Follow screen) watches it more closely: alerts when
it changes room, arrives or leaves, and, with Room-change tag events on, the `padspan_room_change`
event.

**HACS.** The Home Assistant Community Store, through which PadSpan is installed and updated on Home
Assistant 2026.10 and older.

**Health.** The screen that gathers PadSpan's checks; the status dot opens it. **Problems found** is its
list of things that can put devices in the wrong room.

**iBeacon.** A beacon format with a fixed UUID, major and minor number. PadSpan follows an iBeacon by
those, not by its address.

**IRK (Identity Resolving Key).** A phone's or watch's secret key for its changing Bluetooth
addresses. With it, PadSpan can tell that all those addresses are the same phone. Added in Bluetooth →
IRK Manager, or in Home Assistant's Private BLE Device. PadSpan never sends one anywhere and hides
them in every report.

**Label, named device.** A device you have given a name in PadSpan. Only named devices get Home
Assistant entities, events and alerts.

**Licence key.** What unlocks PadSpan Pro (or Bright Pro), entered in Settings → Features → PadSpan
licence. One key covers up to five homes.

**Live Aboard.** The Atlas in 3D, free from December 1, 2026 (Pro and experimental before), with
**Furnish** (Pro) for furniture, devices and people.

**Live and Sample.** Live is your own house; Sample is a finished sample house to look around in
(**Preview a finished house**, and **Back to my house** returns).

**Lost & Found.** The last room PadSpan saw each device in, kept so a device never goes back to
"unknown".

**Marketplace.** Home Assistant's own store (Settings → Marketplace), from Home Assistant 2026.11.

**More tools.** The closed group at the bottom of the panel's menu with the screens that are not in
the main list.

**`not_home`.** Home Assistant's word for away: a PadSpan tracker or area sensor reads `not_home` once
the device has gone unheard for the away timeout.

**Object history.** PadSpan's list of every device it has heard. Unnamed ones drop out after Object
History Retention (1 day unless you change it); named ones stay.

**Poll.** One round of PadSpan's room work, every 5 seconds unless you change it (Settings → Tracking
→ Performance → Presence Poll Interval).

**Power team.** A wall dimmer or switch and the smart bulbs it feeds, made into one light (Settings →
Atlas → Power teams). Making and changing one, and following the day, need PadSpan Pro or the
Advanced smart lighting add-on.

**Private BLE Device.** Home Assistant's integration that follows a phone by its IRK. PadSpan reads
its keys; a key you add there reaches PadSpan within five minutes.

**Pro, and the tiers.** PadSpan HA is free with no key (from December 1, 2026, with exact placement on
the Atlas, the plain wall screen and the 3D house). A key's **tier** says what it unlocks: `pro`
(PadSpan Pro: everything in PadSpan HA, such as fixture shapes, Furnish, the wall screen's extras,
Vacation Mode, Forensics, Busy Times and Locate) or `bright` (Bright Pro: the Atlas's whole
toolset). Free < Bright < Pro, each with all of the one before. There is a one-time 90-day free **trial**, in Settings →
Features → PadSpan licence.

**Put it on the map.** The button (at the end of Setup, and on a room in Rooms) that takes rooms and
receivers drawn on a measured floor plan onto the map of the house. Until then, devices are placed by
nearest receiver only.

**Receiver.** A device that hears Bluetooth advertisements and passes them to Home Assistant: an ESPHome
Bluetooth proxy, a Shelly Gen2 or newer, the Home Assistant machine's own Bluetooth, an ESPresense
node or a Tasmota device. Also called a **Bluetooth proxy** or a **scanner**. One in each room you want
told apart.

**Room.** A Home Assistant area (see Area), drawn on the map of the house. A receiver's area decides
which room it stands in.

**Room Change Delay.** How long a new room must keep winning before a device moves there (40 seconds
unless you change it).

**Rotating address, random address.** A Bluetooth address a phone, watch or Find My tag changes every
so often so it can't be followed. PadSpan follows a phone through it with the phone's IRK or BLE
Transmitter.

**RSSI.** Received signal strength: how loudly a receiver hears a device, in dBm.

**Status dot.** The small mark in the top bar that shows only when something is wrong: amber needs a
look, red is broken.

**Sub-zone.** An area inside a room (a bed, a couch, a desk), drawn in Mapping → Edit → Sub-zones, with
its own entities.

**Traceback.** The screen that shows where devices were, back in time.

**Usage report.** The opt-in, daily, anonymous report (Settings → Tracking → Help improve PadSpan).
Off unless you turn it on.

**Update check.** PadSpan's daily question to `padspan.traks.ca` about a newer stable version,
carrying only the version number.

**Vacation Mode.** Switches lights as on an ordinary day, learned from Home Assistant's history, while
you are away (Mapping → Atlas builder, Pro).

**Wall screen, kiosk.** A tablet or screen on the wall showing the Atlas, opened with `?kiosk=1`
(Settings → Atlas → Wall screens).
