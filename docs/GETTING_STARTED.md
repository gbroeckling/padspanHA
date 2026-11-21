# Getting Started with PadSpan HA

This guide walks you through your first 30 minutes with PadSpan — from install to tracking your first device across rooms.

> **New install?** [From the Marketplace to your first room](https://padspan.traks.ca/guides/get-started/) has the current first steps, with pictures: Who's where now, Make it a map and Put it on the map.

> **Just here for light control, no BLE presence tracking?** This whole guide is about the BLE tracking side. Skip to the [Atlas Guide](ATLAS_GUIDE.md) instead — that's the device map (lights, fans, sensors, locks, doors) and it works the same whether you're on PadSpan HA or [PadSpan Bright](https://github.com/gbroeckling/padspanBright).

## Prerequisites

- Home Assistant **2024.8** or newer
- At least **one BLE scanner**: an ESPHome Bluetooth proxy (an ESP32 board), a Shelly Gen2 or newer set as a Bluetooth scanner, your Home Assistant machine's own Bluetooth, an ESPresense node, or a Tasmota device (experimental, see below)
- The Marketplace (built into Home Assistant from 2026.11) or HACS (older versions), for installing and updating

> **What you need for room-level tracking**
> - **Scanners:** one in each room you want told apart. One scanner alone gives home/away, not rooms. A room with no scanner of its own (a closet, a hall) can only be picked out with calibration, and less reliably. An open-plan kitchen and living room count as one room unless each end has its own.
> - **Cost:** an ESP32-S3 or ESP32-C3 board with an external antenna is roughly US$10–25; Ethernet boards cost more. A five-room house is about US$50–125 in boards, plus USB power supplies.
> - **Time:** install and the first room take about 30 minutes. Calibration (optional, for better accuracy) is 2–3 points per room at 15 seconds each, about 1–2 minutes per room with walking: 15–30 minutes for a ten-room house.

## Choosing Scanner Hardware

PadSpan's goal is placing devices in the correct room on your floor plan — not just home/away. That's a harder problem, and hardware matters more than you'd think.

I started with about a dozen old ESP32 boards from a project three years ago and ordered 10 more for testing. Most of the old boards made poor BLE scanners — noisy, inconsistent signal readings. The few that had decent antennas worked OK, which is what narrowed it down: **the antenna is the thing that matters**, more than the chip.

### What worked (ranked)

1. **ESP32-S3 with Ethernet (LAN) port + external antenna** — The wired connection means no WiFi radio competing with BLE scanning. Honestly it didn't test noticeably better than WiFi, but for a permanent always-on scanner it feels like the right call.
2. **ESP32-S3 with external antenna (WiFi)** — Probably the most practical option for most people. Great BLE 5.0 support, no need to run Ethernet to every room.
3. **ESP32-C3 with external antenna** — Cheaper than the S3 and still performed well for room-level tracking.

### What to look for

- **IPEX / u.FL antenna connector** with an included 2.4 GHz antenna
- **ESP32-S3 or ESP32-C3** chip (newer BLE 5.0 support)
- Any board running **ESPresense** or **Bluetooth Proxy** firmware

### Already have Tasmota devices? (experimental)

Tasmota devices with BLE (for example an ESP32 running Tasmota) can be scanners too, over MQTT:

1. Make sure Home Assistant's **MQTT** integration is set up and the Tasmota devices talk to it.
2. In PadSpan, **Manage → HA Entities → Tasmota BLE → Read Tasmota BLE over MQTT**.
3. In each Tasmota's console, run `TelePeriod 10`, `BLEMaxAge 30` and `BLEAddrFilter 1`. Without
   `BLEAddrFilter 1`, phones and tags with random addresses are never reported.
4. Each device shows up as a scanner the next time it reports. Place it in its room in Mapping like
   any other scanner.

Readings older than about 15 seconds don't count towards rooms, so keep `TelePeriod` short.

### What to avoid

- **Onboard chip/PCB antennas only** — the tiny antennas on most dev boards produce noisy RSSI readings that make room discrimination unreliable
- **Older ESP32 boards** (not S3/C3) with no external antenna — fine as basic Bluetooth proxies or for home/away, but too inconsistent for room-level accuracy

### Why the antenna matters

Home/away just needs to see *any* signal from *any* scanner — easy. Room-level tracking needs to reliably tell which scanner is closest, and sometimes the difference is only 7 dBm. A noisy chip antenna can flip that decision randomly. A full-size external antenna keeps the readings consistent enough for PadSpan to get the room right.

## Step 1: Install

[![Open PadSpan in your Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gbroeckling&repository=padspanHA&category=integration)

The button opens PadSpan in the Marketplace on Home Assistant 2026.11 and newer, and in HACS on older versions.

### From the Marketplace (Home Assistant 2026.11 and newer)

1. Open **Settings → Marketplace** and search for **PadSpan**
2. Open **PadSpan HA** and choose **Install**. The first time, the Marketplace asks you to confirm that what it lists isn't reviewed by the Home Assistant project
3. The setup dialog opens right away, with no restart. Choose **Submit**

### Via HACS (Home Assistant 2026.10 and older)

PadSpan is in the HACS default list, so there's no custom repository to add.

1. Open HACS in your Home Assistant instance
2. Search for and install **PadSpan HA**
3. **Restart Home Assistant completely** (Settings → System → Restart)

### Manual
1. Download the [latest release ZIP](https://github.com/gbroeckling/padspanHA/releases/latest)
2. Extract `custom_components/padspan_ha/` into your HA `config/custom_components/` directory
3. Restart Home Assistant

## Step 2: Add the Integration

From the Marketplace, the setup dialog has already opened: choose **Submit** and you're done. After HACS or a manual install:

1. Go to Settings → Devices & Services → **Add Integration**
2. Search for **PadSpan HA**
3. Choose **Submit**: there is nothing to fill in

## Step 3: Open PadSpan

Open **PadSpan HA** in the sidebar. (The other new sidebar entry, **Atlas**, is the map of your lights and devices; leave it for later.)

A new install shows a made-up sample house until Home Assistant reports its first Bluetooth scanner, then switches to your own house by itself. The first screen is the **Overview**, with **Who's where now**: each room, the named devices in it, and a count of everything else its scanner hears. A device belongs to the room whose scanner hears it best. No floor plan needed.

The line at the top of the card says what your scanners give you so far: no scanner found yet, scanners with no Home Assistant area (home or away only), one room, or several rooms.

## Step 4: Give every scanner its room

A scanner's room is the Home Assistant area of its device. A scanner with no area gives no room, however well it hears you, so this comes first. Set the area on the device in Home Assistant (**Settings → Devices & services → Devices**), or in PadSpan: on the **Overview**, in the **Bluetooth radios** card, select **View radios list**, then **Assign** beside the scanner.

## Step 5: Name your phone and tags

A device you haven't named gets no entities. Naming one gives Home Assistant a device for it with a tracker (`device_tracker.<name>`, whose state is the room), an area sensor (`sensor.<name>_area`) and distance sensors.

- **Android phone:** switch on **BLE Transmitter** in the Companion app (Manage sensors), then on the **Overview**, under **Track Your Phone**, select **Track this phone**.
- **iPhone or Apple Watch:** get its IRK into Home Assistant (Step 9), then select **Track** beside its name in **Who's where now**.
- **A beacon or key tag:** on the **Overview**, in the **Objects** card, open **All objects**, select **Tag** on its row, type a name and select **Save label**. **Devices → By Room** (Devices is under More tools) has the same **Tag** button.

Each named device gets a **stable padspan_id** that survives MAC rotation and firmware updates, *provided the device has a stable identifier* (an iBeacon UUID for the Companion App and many key finders, an IRK for phones).

**About AirTags / Samsung SmartTags:** these change their address and everything else they send (an AirTag every 15 minutes near its owner's iPhone, once a day away from it), with no stable identifier. For Find My tags, turn on **Settings → Features → MAC Rotation Bridging**: a tag you've named or followed carries on to its next address when it's clear which one it is. It won't guess between two tags lying together, and a tag that was out of range when it changed comes back nameless. **Apple Device Classification** only adds a label.

## Step 6: Preview a finished house

**Preview a finished house**, on the **Who's where now** card, shows the sample house: three floors with every feature set up, and made-up names. A yellow banner says you're looking at it; **Back to my house** returns to yours.

## Step 7: Make it a map (optional)

A floor plan turns the list of rooms into your house, drawn on the Overview. Calibration needs it, and with three or more scanners placed on it, PadSpan can also place devices between them. Select **Make it a map** on **Who's where now**. It opens **Setup**: upload a floor plan, set its scale, draw the rooms, set floor heights (two floors or more), place your scanners, then **Put it on the map** and calibrate.

See [Floor Plan Setup](FLOOR_PLAN_SETUP.md) for each step.

## Step 8: Start Following

Open **Follow**:
1. Pick a device under **Choose a tag to follow**
2. Watch which room it is in, live; Advanced mode also lists its recent room changes
3. Optionally set up **Movement Alerts**: on your phone (pick it under Notify service), by email, or both. **Send Test** checks where they go, and nothing is active until you press **Save**

## Step 9: Tracking Apple Devices (iPhone, Apple Watch)

Apple devices use rotating MAC addresses for privacy. To track them:

1. Set up the **Private BLE Device** integration in HA (registers the device's IRK)
2. PadSpan auto-detects registered Private BLE devices
3. Select **Track** beside the phone in **Who's where now** (or **Tag** it in Devices → By Room): it appears with its friendly name (e.g., "Adam's iPhone")
4. The IRK lets PadSpan follow the device through MAC rotations

The Training Hub has a dedicated walkthrough: **Private BLE (Apple Devices)**.

**There is no "BLE Transmitter" on an iPhone.** That sensor is in the Android Companion App only, so an iPhone is followed by its IRK instead:

1. **Get the IRK.** Pair the iPhone with an ESP32 running [irk-capture](https://github.com/DerekSeaman/irk-capture), then press **Auto-detect IRKs** in Bluetooth → IRK Manager (Bluetooth is under More tools). Or, on a Mac signed into the same iCloud account, run `sudo defaults read /private/var/root/Library/Preferences/com.apple.bluetoothd.plist` and copy the IRK under the iPhone's name. **Settings → Tracking → Phones and guest tags → Phone Tracking (Private BLE) → Detailed Setup Guide** has these and the Keychain way, step by step.
2. **Add it** in HA: Settings → Devices & services → Add integration → **Private BLE Device**, and paste the IRK. PadSpan reads Private BLE Device's keys every 5 minutes, so it can take up to five minutes to pick it up. A key added through PadSpan itself (the Phone Tracking (Private BLE) card, or Bluetooth → IRK Manager) is used straight away.
3. **Check it resolves.** With the iPhone awake near a scanner it appears under **Registered IRK devices** in the IRK Manager, and the Resolved count goes up. **Test only** there checks a key without saving it.

Turn on **iPhone Setup Path** in Settings → Features and PadSpan walks you through these steps itself: an iPhone in Overview's phone list gets them behind its Setup button, and the IRK Manager's phone wizard gets an "I have an iPhone" path with a Check button. It is off by default; Android phones see the same BLE Transmitter steps either way.

## Step 10: Occupancy Estimation

The **Occupancy** view counts people in the building — never devices:

1. **Known people** are your HA `person` entities that are home, one per phone (two person entities on the same device tracker are one person). A PadSpan object labelled with the phone's name, or linked to its tracker, places that person in a room.
2. **Unclaimed phones** are rotating BLE addresses whose advert says "phone or watch in a pocket" (Apple Nearby Info / Handoff, wearable makers), heard strongly by two or more scanners. Phones in one room are one person — a phone and its watch, or a phone across an address rotation. A known person placed in that room owns them; a known person who is home but not placed is assumed to be them; the rest are unknown people.
3. **Occupancy and presence sensors** (by `device_class`, in their HA area, indoors) are a floor: every occupied room needs a body, and the bodies are the people already counted. An occupied room with nobody placed in it raises the possible range, not the count, unless nobody is known at all. Motion places people and floors an otherwise empty count; motion held on for over an hour is ignored as a stuck input.
4. **Tagged things** — keys, beacons, boxes, vehicles — are listed as seen and never counted.

Record the real headcount in the view to keep it beside what the estimate said.

## Ask Assist where someone is

What Home Assistant's own Assist sentences already do (checked against the HA intents repo and core, 2026.10):

- **"Where is Alice?"** works for `person` entities only (HassGetState, `name_where`). A person takes a PadSpan tracker's room as its state only when no other tracker on that person says more: a phone's GPS (the Companion app) or a router's "home" always wins over a room. So with the Companion app attached, Assist says "Alice is at home", not the room. With the PadSpan tracker as the person's only tracker it says "Alice is at Kitchen" (and "Alice is away" once away).
- **"What is Alice Area?"** works for the Area sensor (HassGetState, `name_only`) and says "Alice Area is Kitchen". It does work, but it isn't something anyone would say.
- "Where is ..." never matches a `sensor` or a `device_tracker` by itself.

To use either one, expose the entity: **Settings → Voice assistants → Expose**, add `sensor.<device>_area` (or the `person` with the PadSpan tracker attached under **Settings → People**). Give it an alias such as "Alice" if you like.

For an answer that always names the room, PadSpan adds a `PadSpanWhereIs` intent. It does nothing until you add these sentences yourself. Save this as `config/custom_sentences/en/padspan.yaml` and restart Home Assistant (or reload it from the Assist debug page). The panel shows the same lines, with a Copy button and examples in your own devices' names, under **Settings → Tracking → Home Assistant and integrations → Ask Assist which room someone is in**:

```yaml
language: "en"
intents:
  PadSpanWhereIs:
    data:
      - sentences:
          - "which room is {padspan_person} in"
          - "what room is {padspan_person} in"
          - "where in the house is {padspan_person}"
lists:
  padspan_person:
    wildcard: true
```

The name is the device's PadSpan label ("Alice"). It also matches a label that starts with that name ("Alice's Phone", "Alice Watch"); if there are several, it picks the one heard most recently. Answers: "Alice is in the Kitchen", "Alice is probably in the Kitchen" when the room confidence is under 50%, "Alice is away", or "I don't know anyone called ...". You don't need to expose anything. The intent only reads PadSpan's current room and never changes anything. The answers are in English. "Where is Alice" is left to Home Assistant's own sentence above.

## What PadSpan never touches

PadSpan sits next to your other integrations. It doesn't manage them. Enabling, disabling, reloading or removing PadSpan doesn't change another integration's devices, entities or config entries (see the shared-device note below for one thing Home Assistant itself did before 2026.8). That covers Private BLE Device, Bermuda, ESPresense, the Companion App and everything else. A test in the repo (`tests/test_never_touches_others.py`) fails the build if new code tries to.

**What it reads.** Your HA areas and floors (HA is where rooms live), the device and entity registries, the Bluetooth advertisements HA already receives, entity states, and the Private BLE Device and Companion App entries, read only to put a name to a phone's rotating address. Vacation Mode also reads your lights' recorder history, but only once you turn it on, and the People at home only if you turn on its pause-while-someone-is-home option.

**What it creates.** Its own config entry and its own `padspan_ha` entities and devices: trackers, area and distance sensors, sub-zones, occupancy. It also creates its own files under `.storage/padspan_ha.*`. When you use the door relay builder, it makes `padspanha_*` helpers, scripts, automations and one template entity, keeps a list of them, and its Remove button deletes exactly what's on that list.

**What it never changes on its own.** Other integrations' devices, entities, config entries, or the areas and floors themselves. Setup, the background loop, timers, unload and removal make no registry or config-entry changes outside PadSpan's own. The only places PadSpan acts on someone else's object are buttons you press, one object at a time, in admin screens:

- **Settings → Tracking → Phone Tracking (Private BLE): Add / Delete from HA** adds or removes a Private BLE Device entry. That entry belongs to Private BLE Device, so deleting it there deletes it from HA (two-step confirm).
- **Manage → HA Entities → Delete** and **Manage → Areas → Delete** remove the entity or area you picked from Home Assistant.
- **Assigning a radio or a light to a room** sets that device's or entity's HA area.
- **Enable & Track** on a phone re-enables the Companion App's BLE Transmitter sensor if it was disabled. It never disables anything.

One shared-device note: before Home Assistant 2026.8, a PadSpan sensor that gave HA a tag's Bluetooth address was filed under any other integration's device with that exact address (Bermuda's, say). From PadSpan 0.38.162 it gives that address only on Home Assistant 2026.8 or later, which keeps the devices apart itself. A device merged that way before stays merged; removing PadSpan only takes its own entities off it.

**What uninstalling removes.** Deleting PadSpan from Devices & Services makes Home Assistant remove PadSpan's own entities, and any device that only PadSpan was using. It also gives every WLED light PadSpan was running its WLED sync back. Some things stay behind, by design: the `.storage/padspan_ha.*` files (Manage → Factory Reset clears your setup from them first; the licence is kept), anything you added to other integrations through the buttons above (an IRK stays in Private BLE Device), and door-builder automations unless you remove the door in PadSpan first.

## Who can change what

Every Home Assistant user can open PadSpan. Some things always need a Home Assistant administrator: backups and restores, factory reset, adding, removing, testing or looking for IRKs, uploading or deleting floor plans, the usage report, and the Live Aboard switches that let data leave the house.

Everything else is open to every user unless **Settings → Tracking → Enhanced security** is on. A new install starts with it on; a home set up before November 2026 keeps it off until someone turns it on. Only an administrator can turn it on or off. While it is on, only an administrator can change PadSpan's shared setup for the home:

- devices: merging, deleting, renaming and labelling them
- calibration points and the calibration model
- the house layout: rooms, scanners, lights, beacons, walls, floor heights and map details
- scanner offsets, and turning radios off or marking them lost
- Follow alerts, phones added for tracking, and Find My links
- clearing history, forgetting lost items and suspending learning
- Live Aboard edits, sharing to its library and its photo reader
- PadSpan's log
- settings that apply to the whole home, such as the update check

Household members can still view everything, use the lights and the emergency lighting test, send Follow's test notification, change the theme and the choices kept in their own browser (Map or 3D, what the Atlas shows, how much of the menu they see), and assign a Bluetooth radio to a room (Overview → Bluetooth radios → Assign). Display settings that change every screen in the home (Quiet mode, the Atlas as Overview, the Atlas layout and its showcase theme) need an admin while it is on. When they try anything on the list, PadSpan says "Only an admin can change this while Enhanced security is on". More protections will be added to the same switch over time.

## What's Next?

- **Atlas** — Lights, fans, sensors, locks and doors on the same map: free installs get a tap-to-toggle marker per light, and placing devices where they really are is PadSpan Pro — see the [Atlas Guide](ATLAS_GUIDE.md)
- **Calibration** — Open **Calibration** in the menu and select **Guided calibration** for better room accuracy; the Training Hub's **Calibrate for Accuracy** walkthrough shows how
- **Basic vs Advanced** — The mode button in the top bar switches between Basic, Advanced and Development
- **Training Hub** — 16 animated walkthroughs covering every feature
- **Settings** — Customize appearance, scanner offsets, presence thresholds, experimental features
- **History & Traceback** — Review movement history with NVR-style playback on the 3D map

## Troubleshooting

- **No scanners visible?** Confirm your ESP32 or Bluetooth proxy is connected and showing in HA → Settings → Devices & Services → Bluetooth. The **Receivers** page lists every scanner PadSpan hears, with its status.
- **"Bluetooth feed unavailable" right after installing?** Restart Home Assistant fully (Settings → System → Restart); reloading the integration isn't enough after a first install.
- **No devices?** Wait 30 seconds — the first BLE scan takes a moment. A device must be in range of at least one scanner and sending Bluetooth.
- **The status dot in the top bar is amber or red?** Click it: it opens **Health**, which says what is wrong.
- **A device is in the wrong room, or jumps between rooms?** Check each scanner has the right Home Assistant area (Step 4), then see [Why does my phone jump between rooms?](https://padspan.traks.ca/guides/room-flapping/). **Settings → Tracking → Rooms and timing → Room Change Delay** (20–60 seconds) steadies a device on a room boundary.
- **A device shows not_home too soon?** Raise the away timeout in **Settings → Tracking → Rooms and timing → Home/Away Timeout** (5 minutes unless changed).
- **A phone won't show up?** [Which room is my phone in?](https://padspan.traks.ca/guides/phone-room-presence/) has the steps for Android, iPhone and Apple Watch, and what to check.
- **Mapping has only Library and Upload, or Settings has no tabs?** The mode button in the top bar has switched the panel to **Basic**. Every screen is still in the menu (the ones not in Basic's short list are under **More tools**). Select the button again for **Advanced**.
- **Uploading a plan, saving the scale or starting the trial is refused?** Those need a Home Assistant administrator.
- **UI not updating?** Hard refresh your browser (Ctrl+F5) to clear cached JavaScript
- **Asking for help?** Open **Diagnostics** (QA → Go to Diagnostics; QA is under More tools) or **Monitor → Export for support**, and email the report to hello@traks.ca or attach it to a [GitHub issue](https://github.com/gbroeckling/padspanHA/issues) (issues are public: remove personal details first).
