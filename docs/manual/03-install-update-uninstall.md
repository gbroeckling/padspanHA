# 3. Install, update, uninstall

[Contents](README.md)

PadSpan HA needs Home Assistant 2024.8 or newer and at least one Bluetooth receiver. See
[Minimum requirements](../MINIMUM_REQUIREMENTS.md) for the machine and the receivers.

## Install

[![Open PadSpan in your Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gbroeckling&repository=padspanHA&category=integration)

The button opens PadSpan in the Marketplace on Home Assistant 2026.11 and newer, and in HACS on older
versions.

### From the Marketplace (Home Assistant 2026.11 and newer)

1. Open **Settings → Marketplace** and search for **PadSpan**.
2. Open **PadSpan HA** and choose **Install**. The first time, the Marketplace asks you to confirm
   that what it lists isn't reviewed by the Home Assistant project.
3. The setup dialog opens right away, with no restart. Choose **Submit**.
4. Open **PadSpan HA** in the sidebar.

### With HACS (Home Assistant 2026.10 and older)

PadSpan is in the HACS default list, so there is no custom repository to add.

1. Open HACS, search for **PadSpan HA** and download it.
2. Restart Home Assistant completely: **Settings → System → Restart**.
3. Add the integration: **Settings → Devices & services → Add Integration**, search for
   **PadSpan HA** and choose **Submit**.
4. Open **PadSpan HA** in the sidebar.

### By hand

1. From the [latest release](https://github.com/gbroeckling/padspanHA/releases/latest), download
   `padspan_ha.zip`.
2. In Home Assistant's config folder, make the folder `custom_components/padspan_ha`.
3. Unzip `padspan_ha.zip` into that folder. Its files have no folder of their own: when you are done,
   `manifest.json` is at `custom_components/padspan_ha/manifest.json`.
4. Restart Home Assistant, then add the integration as in step 3 of HACS above.

An install by hand gets no update offers. You repeat these steps for each new version.

### What you see after installing

PadSpan adds two entries to the sidebar: **PadSpan HA** (the panel) and **Atlas** (the lighting map;
it can be switched off). A new install opens on your own house as soon as Home Assistant reports a
Bluetooth receiver, and shows **Who's where now**. A new install also starts with **Enhanced
security** on: changes to PadSpan's shared setup need a Home Assistant administrator.

## Update

### Stable and beta

PadSpan has two kinds of release.

- **Stable** is what the Marketplace and HACS install and offer by default. Most homes should stay on
  stable.
- **Betas** come out often, sometimes several in a day, so a fix reaches testers the day it is made.
  They are GitHub pre-releases. HACS offers a beta only to those who asked it for betas. A beta's
  release notes say BETA in their title.

To get betas in HACS 2: go to **Settings → Devices & services → HACS**, open the **PadSpan HA**
device, and switch on its **Pre-release** entity. Home Assistant creates that entity switched off and
disabled, so enable it first (its settings, **Enabled**). To go back to stable, switch it off again;
HACS then offers the next stable.

### Step by step

1. Open **Settings → System → Updates**. A new PadSpan HA shows there (in HACS, it also shows on
   **PadSpan HA**).
2. Choose **Install**. The release notes are in the same dialog.
3. Restart Home Assistant: **Settings → System → Restart**.
4. Reload the PadSpan page in each browser that has it open (Ctrl+F5 on a computer).

After the update, PadSpan's Overview shows **PadSpan HA updated to v…** with **See what changed**
(the release notes, inside the panel) and **Dismiss**.

A browser still running the old version says so in a bar at the top, with a **Reload** button:

- "PadSpan was updated to v…. This page is still running v…": reload the page.
- "This page is v…, but Home Assistant is running PadSpan v…. If you just updated, restart Home
  Assistant.": the new files are in place but Home Assistant has not restarted yet.

A wall screen opened with `?kiosk=1` reloads itself once after an update, when nobody has touched it
for two minutes, so it never keeps running old code.

### PadSpan's own update notice

Once a day PadSpan asks `padspan.traks.ca` whether a newer stable version exists. The request carries
only the installed version number. When there is one, Home Assistant shows a notification: **PadSpan
HA update available**, "PadSpan HA … is available (you run …)", with a link to the release notes. It
is shown once for each new version (after a Home Assistant restart, the next daily check can show it
again until you update), and only for stable releases. The first check comes at a random time between 5 minutes and
6 hours after Home Assistant starts, then once a day.

To turn it off: **Settings → Tracking → Privacy, updates and feedback → Update Check**, and set it to
**Disabled**. The Marketplace and HACS still offer updates on their own. With a licence key entered,
the key is still checked with `traks.ca` once a day.

## Uninstall

### Before you remove it

- **Door openers built from relays** (Devices → Door Openers) are made of Home Assistant scripts,
  automations, a helper and a template entity, all named `padspanha_…`. Removing PadSpan leaves them.
  To delete them, choose **Remove** on each one in Devices → Door Openers first.
- **An iPhone key (IRK) you added from PadSpan** is a Private BLE Device entry. It stays after PadSpan
  is gone. Delete it in **Settings → Devices & services → Private BLE Device** if you no longer want
  it.
- **To keep your house for later**, make a Home Assistant backup now (see
  [chapter 22](22-backup-restore-moving.md)). PadSpan's own backups live in PadSpan's files and go
  when you delete those.

### Step by step

1. Open **Settings → Devices & services → PadSpan HA**, open the menu (⋮) and choose **Delete**.
   Home Assistant removes PadSpan's entities and the devices only PadSpan used. PadSpan gives every
   WLED light it was running its WLED sync back. With the usage report on, PadSpan sends one last
   report that says it was removed, with nothing about the house.
2. Remove the code:
   - Marketplace: open **PadSpan HA** in **Settings → Marketplace** and remove it.
   - HACS: open **PadSpan HA** in HACS, open the menu (⋮) and choose **Remove**.
   - By hand: delete the folder `custom_components/padspan_ha`.
3. Restart Home Assistant. The **PadSpan HA** and **Atlas** sidebar entries are gone.

### What stays behind

Home Assistant does not delete an integration's files when it is removed. PadSpan's stay in Home
Assistant's config folder until you delete them:

| What | Where | Holds |
|---|---|---|
| PadSpan's data files | `.storage/padspan_ha.*`, one file for each kind of data | Settings, licence key, maps, rooms, calibration, labels, history, PadSpan's own backups and the rest |
| Two folders of data | `.storage/padspan_ha.traceback_segments/` and `.storage/padspan_ha.capture_sessions/` | Traceback's history, and RSSI recordings (only if you made one) |
| Floor plan pictures | `padspan_ha/maps/` | The plans you uploaded |
| WLED backups | `padspan_ha/wled_backups/` | Only if you backed up a WLED device from PadSpan |
| An unreadable file set aside | `.storage/padspan_ha.<name>.unreadable.<time>` | Only if PadSpan once found a file it could not read |
| Old map folder | `www/padspan_ha/maps/` | Only on a house that never ran 0.38.143 or later: newer versions move the pictures out of it |

To remove them all:

1. Uninstall as above and restart Home Assistant.
2. Using the File editor, Samba share, SSH or Studio Code Server add-on, delete in the config folder:
   every file and folder in `.storage` whose name starts with `padspan_ha.`, the folder
   `padspan_ha`, and `www/padspan_ha` if there is one.

Delete them only with PadSpan removed: while it runs, it writes them again.

Also left in Home Assistant, outside PadSpan's files:

- **Tags**: with **Room-change tag events** switched on (Settings → Tracking → Home Assistant and
  integrations → HA Tags Integration), Home Assistant's Tags list has a tag named `padspan_…` for each
  followed device that changed room. Delete them in **Settings → Tags** if you like.
- **History**: Home Assistant's database keeps the past states of PadSpan's entities until its own
  history setting purges them (10 days unless you changed it).
- **Anything you added to another integration** from PadSpan's buttons, as above.

**A Factory Reset is not an uninstall.** Manage → Factory Reset empties PadSpan's files and keeps
PadSpan installed. It keeps your licence key. See [chapter 22](22-backup-restore-moving.md).

### Installing again

PadSpan finds its files in `.storage` if they are still there, and comes back with the house as it
was. A house whose files were deleted starts like a new install.
