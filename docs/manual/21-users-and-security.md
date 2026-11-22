# 21. Users and Enhanced security

[Contents](README.md)

PadSpan uses Home Assistant's own users. There are no PadSpan accounts or passwords: what someone
may do in PadSpan follows from whether their Home Assistant user is an **administrator**.

## Who can open PadSpan

Every Home Assistant user can open PadSpan and the sidebar Atlas, and see everything on them.
Household members can always use the lights, the emergency lighting test and Follow's test
notification, change the theme, and change the choices kept in their own browser (Map or 3D, what the
Atlas shows, Basic or Advanced).

## What always needs an administrator

Whatever the settings, only an administrator can:

- make, restore and delete backups, and factory reset;
- add, remove, test or look for IRKs (phone keys);
- upload or delete floor plans;
- turn the usage report on or off, and sign up as a tester;
- turn on the Live Aboard switches that let data leave the house (the shared furniture library), and
  pick the AI Task;
- turn guest tags on, lend a tag and end a stay;
- make and change power teams;
- turn Vacation Mode on or off;
- change who runs a WLED light;
- turn Enhanced security on or off.

Someone who isn't an administrator is told so when they try.

## Enhanced security

For homes where other people have Home Assistant accounts.
**Settings → Tracking → Privacy, updates and feedback → Enhanced security.** A new install starts with
it on; a home set up before November 2026 keeps it off until an administrator turns it on.

While it is on, only an administrator can change how PadSpan is set up for the home:

- devices: merging, deleting, renaming and labelling them;
- calibration points and the calibration model;
- the house layout: rooms, receivers, lights, beacons, walls, floor heights and map details;
- receiver signal adjustments, and turning receivers off or marking them lost;
- Follow alerts, phones added for tracking, and Find My links;
- clearing history, forgetting lost items and suspending learning;
- Live Aboard edits, sharing to its library and its photo reader;
- PadSpan's log;
- settings that apply to the whole home (the update check, positioning and the rest), and display
  settings that change every screen (quiet mode, the Atlas as Overview, the Atlas layout and its
  Showcase theme).

Household members can still view and use everything as above, and give a receiver its room
(**Set room** on the Overview's **Who's where now**, or **Assign** under **Bluetooth radios**), which
stays open to everyone on purpose. When they try anything on the list, PadSpan says
**"Only an admin can change this while Enhanced security is on"**. With it on, only an administrator
sees **Track** beside a phone in **Who's where now**.

More protections may be added to the same switch later; the card on the Settings tab always lists
what it covers today.

## A wall screen or a shared tablet

A screen in a hall or kitchen is logged in to Home Assistant as somebody. Give it its own Home
Assistant user that is **not** an administrator, and turn Enhanced security on. Then anyone passing
can use the lights and look at the map, but can't change the setup, make a backup or reset PadSpan.
Hide the emergency lighting test button too, if it shouldn't be pressed by just anyone
([chapter 15](15-the-atlas.md#emergency-lighting-test)). Setting up the screen:
[chapter 18](18-wall-screens-and-kiosks.md).

## What else PadSpan does to stay safe

- Names from devices, receivers, rooms and users are always shown as plain text in the panel, so a
  device named like a piece of code can't run in it.
- Map uploads and imports are size-limited, and the floor-plan importer refuses unsafe files.
- Follow alerts and the Test button send only to notification targets, and the Test sends as the
  person who pressed it.
- Phone keys (IRKs) stay in your Home Assistant and never leave it. The licence key never goes to the
  browser with the settings.

**Found a security problem?** Don't open a public issue: report it privately as
[SECURITY.md](../../SECURITY.md) says, through GitHub's Security Advisories or by email.
