# 22. Backup, restore, factory reset, moving to a new Home Assistant

[Contents](README.md)

PadSpan keeps two kinds of copy of your house, and they do different jobs.

- **PadSpan's own backups** (Manage → Data → Backup & Restore) are for going back: before a big
  change, or after one that went wrong. They live inside PadSpan's own files, on the same machine.
- **Home Assistant's backup** is for losing the machine, or moving to a new one. It carries PadSpan's
  files with the rest of Home Assistant.

You need both. A PadSpan backup does not survive the machine, and it does not survive a Factory
Reset.

## PadSpan's own backups

Open **Manage → Data → Backup & Restore** (Manage is under More tools in Basic mode). Only a Home
Assistant administrator can make, restore or delete one.

### What a backup holds

**Create Backup** takes a copy of these, all in one go:

- the settings, including your licence key
- the floor plans: their records and the pictures themselves
- rooms, floors, walls, placed lights and receivers (the layout and the room model)
- calibration points and the calibration model
- your device names and PadSpan's list of devices
- follow alerts
- movement history, the last day of Traceback, and the last room of each device (Lost & Found)
- the object history, and the Forensics sessions
- what PadSpan remembers about each WLED device
- Live Aboard's furniture and heights, sub-zones, the plan AI's suggestions and the robot vacuum link,
  each only if you have used it

Not in a PadSpan backup: guest tags and their stays, RSSI recordings, the AI use counter and the
usage report's counters. Home Assistant's own areas, floors, entities and automations are never in
it: they are Home Assistant's, in Home Assistant's backup.

### Where backups live, and how many

All of PadSpan's backups are kept in one file, `.storage/padspan_ha.backups`, with the floor plan
pictures inside it. PadSpan keeps the **3 newest backups you made** (a fourth removes the oldest).
Before some changes it takes one by itself ("Before merging rooms…", "Before putting receivers in
their rooms…", "Before removing all furniture in Live Aboard", a PadSpan Bright import and others);
it keeps the 3 newest of those apart, so they never push out one of yours. There is no button to
download a backup: to keep one off the machine, use Home Assistant's backup, which carries this
file.

### Restore

1. In Backup & Restore, choose **Restore…** on the backup.
2. Tick what to bring back. Each part of the backup is ticked to start with, and **Maps Config** and
   **Model** go together (a plan and where it sits are one thing). The pictures are a tick of their
   own, **Map Images**.
3. Choose **Restore selected**.
4. Reload PadSpan (Settings → Devices & services → PadSpan HA → ⋮ → **Reload**) for everything to take
   effect, as the message says.

A restore puts back what you ticked, with a few things kept as they are now, because they belong to
this install and not to the house:

- **Your licence**: a backup from before you bought a key, or from a trial, never takes the key away.
  The better licence of the two stays.
- **A tester sign-up, an invite's answer, and what the update check last said**.
- **Movement and Lost & Found** are joined with what happened since, not replaced.
- **Live Aboard's furniture** placed since stays when the backup has none.

## Factory Reset

**Manage → Factory Reset** empties PadSpan's files and starts it again as new, with PadSpan still
installed. It works only in Live mode, needs an administrator, and asks you to type `FACTORY RESET`
before **Erase All Data & Reset** can be pressed.

It erases calibration, floor plans and their pictures, rooms and receivers, your device names, follow
alerts, history and Traceback, Forensics, learned data, Live Aboard's furniture, guest tags,
sub-zones, every setting, and **all of PadSpan's own backups**. Make a Home Assistant backup first
if you might want any of it back.

It keeps your licence key, a tester sign-up and furniture you shared to the library (so you can still
withdraw either), and Vacation Mode's learned routine. It changes nothing in Home Assistant itself:
areas, floors, entities and devices stay. A Factory Reset during a vacation turns Vacation Mode off.

## Home Assistant's backup

Home Assistant's own backup (**Settings → System → Backups**) copies its config folder, and that is
where PadSpan keeps everything:

| What | Where in the config folder |
|---|---|
| PadSpan's data, settings and its own backups | `.storage/padspan_ha.*` |
| Traceback's history, and RSSI recordings | `.storage/padspan_ha.traceback_segments/` and `.storage/padspan_ha.capture_sessions/` |
| Floor plan pictures | `padspan_ha/maps/` |
| WLED backups made from PadSpan | `padspan_ha/wled_backups/` |
| PadSpan itself | `custom_components/padspan_ha/` |

So **every Home Assistant backup has all of PadSpan in it.** From Home Assistant 2025.1, "Home
Assistant settings" (the config folder) is in every backup and can't be left out; what you choose is
whether to add the history database, media, the share folder and add-ons. PadSpan needs none of
those. On an older Home Assistant OS, a partial backup holds PadSpan only if **Home Assistant** is
ticked in it.

The history database is not PadSpan's: it holds the past states of PadSpan's entities, as it does
for every entity. Leaving it out loses that history, nothing else.

## Moving to a new Home Assistant machine

The way that carries everything is Home Assistant's own:

1. On the old machine, make a backup: **Settings → System → Backups → Back up now**. Download it,
   and keep its encryption key.
2. Switch the old machine off, or at least stop Home Assistant on it. Two machines running the same
   house both listen to the same receivers and both run the same automations, and PadSpan's licence
   check sees two homes (below).
3. On the new machine, start Home Assistant's onboarding and choose to restore from a backup. Give it
   the file and the key.
4. When Home Assistant is up, open PadSpan. Your house, plans, calibration, names and settings are as
   they were.

Then check these, which depend on the machine rather than on the files:

- **The new machine's own Bluetooth.** Receivers on the network (ESPHome proxies, Shelly devices,
  ESPresense, Tasmota) are the same receivers and carry on. If the old machine's own Bluetooth
  adapter was a receiver, the new one is a different receiver: the old one shows as not heard, and
  the new one as new. Place the new one on the map, and use **Replace Scanner** (Settings → Scanner
  Map) to move the old one's calibration to it.
- **Its memory.** Next to a busy street PadSpan hears thousands of devices. See
  [Minimum requirements](../MINIMUM_REQUIREMENTS.md) before moving to a 2 GB machine.
- **Your licence.** The restored copy carries the old machine's place among your licence's homes. The
  licence server hands that place over when the old machine has stopped checking in. If both keep
  running, the new one has to take a home of its own.
- **Wall screens and links**: if the new machine has a new address, open each wall screen's link
  again with the new address.

**Copying only PadSpan's files** (the folders above) into a Home Assistant set up from scratch is not
the same: PadSpan's rooms and layout point at Home Assistant's floors and areas, and its devices at
what Home Assistant knows. It works only where the new Home Assistant has the same floors and
areas. A full Home Assistant backup brings those too.

## Coming from PadSpan Bright

PadSpan Bright (the lighting-only edition) and PadSpan HA can be installed side by side, and PadSpan
HA can take the house you built in Bright.

1. Install PadSpan HA (chapter [3](03-install-update-uninstall.md)), keeping Bright installed.
2. In PadSpan HA, open **Health**. A card **PadSpan Bright found on this Home Assistant** says what
   Bright holds.
3. Choose **Import from PadSpan Bright**. PadSpan HA takes a backup of its own first (it is in Backup &
   Restore), copies Bright's floors, rooms, walls, placed lights, floor plans and their pictures,
   settings and Live Aboard's furniture, then reloads.
4. When the house looks right in PadSpan HA, remove PadSpan Bright. The import never deletes
   Bright's files.

The import runs only into an empty house: if PadSpan HA already has a floor, a room, a light, a wall
or a map, the card says so and offers nothing, and it never merges two houses. Bright's licence key
comes across with its settings, unless you have already entered a key in PadSpan HA.
