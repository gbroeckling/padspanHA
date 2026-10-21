# Getting Started with PadSpan HA

This guide walks you through your first 30 minutes with PadSpan — from install to tracking your first device across rooms.

> **Just here for light control, no BLE presence tracking?** This whole guide is about the BLE tracking side. Skip to the [Atlas Guide](ATLAS_GUIDE.md) instead — that's the device map (lights, fans, sensors, locks, doors) and it works the same whether you're on PadSpan HA or [PadSpan Bright](https://github.com/gbroeckling/padspanBright).

## Prerequisites

- Home Assistant **2024.1** or newer
- At least **one BLE scanner** (ESP32 Bluetooth Proxy, ESPresense, or built-in HA Bluetooth)
- HACS installed (recommended)

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
2. In PadSpan, **Manage → Tasmota BLE → Read Tasmota BLE over MQTT**.
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

### Via HACS (recommended)
1. Open HACS → Integrations → three-dot menu → **Custom repositories**
2. URL: `https://github.com/gbroeckling/padspanHA` — Category: **Integration**
3. Search for **PadSpan HA** and install it
4. **Restart Home Assistant completely** (Settings → System → Restart)

### Manual
1. Download the [latest release ZIP](https://github.com/gbroeckling/padspanHA/releases/latest)
2. Extract `custom_components/padspan_ha/` into your HA `config/custom_components/` directory
3. Restart Home Assistant

## Step 2: Add the Integration

1. Go to Settings → Devices & Services → **Add Integration**
2. Search for **PadSpan HA**
3. Follow the config flow (defaults are fine for most setups)

## Step 3: Onboarding Wizard

When you first open PadSpan, the **onboarding wizard** appears with 5 steps:

1. **Upload a map** — Upload a floor plan image
2. **Set scale** — Use the two-point measure tool to calibrate real-world distances
3. **Draw rooms** — Draw room boundary polygons over your floor plan
4. **Place scanners** — Drag scanner markers to their physical locations
5. **Calibrate** — Walk-around fingerprint collection for room-level accuracy

Each step auto-detects when it's complete. Click any step to jump to the relevant view.

## Step 4: Explore with Sample Mode

Before touching real data, flip to **Sample mode** (toggle in the top-right corner of the panel). This loads a complete demo house with:
- 3 BLE scanners across 5 rooms
- 11 objects (phones, AirTags, Tile trackers, unidentified devices)
- Floor plan with room boundaries
- Follow mode with movement tracking

Explore every view to understand what PadSpan can do.

## Step 5: Switch to Live Mode

Toggle back to **Live mode**. Your BLE scanners are auto-discovered. You should immediately see:
- **Radios** — Your BLE scanners listed in the Bluetooth view
- **Objects** — Every Bluetooth device your scanners detect (phones, AirTags, smart home gadgets, and plenty of unknown devices)

## Step 6: Tag Your Devices

Go to the **Objects** tab. You'll see a mix of named and unnamed Bluetooth devices. Click **Tag** next to any device you recognize:
- Your phone → "Alice's Phone"
- Your Tile → "Backpack"
- Your HA Companion-App iBeacon → "Alice's Phone (BLE)"

Once tagged, PadSpan creates HA entities for that device (device_tracker, area sensor, distance sensor). Each tagged device gets a **stable padspan_id** that survives MAC rotation and firmware updates — *provided the underlying device has a stable identifier* (iBeacon UUID for Tiles / Companion App, IRK for phones).

**About AirTags / Samsung SmartTags:** these rotate both their MAC address and their advertised Find My key every ~15 minutes and broadcast no stable identifier. The padspan_id chain breaks at each rotation. Enable **Settings → Features → MAC Rotation Bridging + Apple Device Classification** for probabilistic tracking that follows the AirTag while it stays in continuous range. Tagging works in that window; expect the chain to reset when the tag leaves and re-enters BLE range.

## Step 7: Upload a Floor Plan

Go to **Maps** → **Upload** tab:
1. Upload a PNG/JPG of your floor plan (or draw one — even a rough sketch works)
2. Use the **measure tool** — click two points of known distance to set the scale
3. Draw room boundary polygons by clicking the map
4. Place scanner markers where your BLE scanners are physically located

See [Floor Plan Setup](FLOOR_PLAN_SETUP.md) for detailed instructions.

## Step 8: Start Following

Go to the **Follow** tab:
1. Select a tagged device from the dropdown
2. Watch it move between rooms in real time on the animated map
3. Optionally configure **email alerts** for room-change notifications

## Step 9: Tracking Apple Devices (iPhone, Apple Watch)

Apple devices use rotating MAC addresses for privacy. To track them:

1. Set up the **Private BLE Device** integration in HA (registers the device's IRK)
2. PadSpan auto-detects registered Private BLE devices
3. Tag them in the Objects view — they appear with their friendly name (e.g., "Adam's iPhone")
4. The IRK lets PadSpan follow the device through MAC rotations

The Training Hub has a dedicated walkthrough: **Private BLE (Apple Devices)**.

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

For an answer that always names the room, PadSpan adds a `PadSpanWhereIs` intent. It does nothing until you add these sentences yourself. Save this as `config/custom_sentences/en/padspan.yaml` and restart Home Assistant (or reload it from the Assist debug page):

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

## What's Next?

- **Atlas** — Place lights, fans, sensors, locks and doors on the same map (Pro feature) — see the [Atlas Guide](ATLAS_GUIDE.md)
- **Calibration** — Run the calibration walkthrough (Training Hub → Calibration) for sub-room accuracy
- **Basic vs Advanced** — Toggle between simplified and full views (top-right toggle)
- **Training Hub** — 16 animated walkthroughs covering every feature
- **Settings** — Customize appearance, scanner offsets, presence thresholds, experimental features
- **History & Traceback** — Review movement history with NVR-style playback on the 3D map

## Troubleshooting

- **No scanners visible?** Confirm your ESP32 or Bluetooth proxy is connected and showing in HA → Settings → Devices & Services → Bluetooth
- **No objects?** Wait 30 seconds — the first BLE scan takes a moment. Check the Diagnostics view for errors.
- **UI not updating?** Hard refresh your browser (Ctrl+F5) to clear cached JavaScript
- **Private BLE devices show MAC instead of name?** Update to v0.17.3+ — friendly names now display by default
- **Maps not saving?** Update to v0.17.2+ — a scale save bug was fixed
