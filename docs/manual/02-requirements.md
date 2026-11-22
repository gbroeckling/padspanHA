# 2. Requirements

[Contents](README.md)

What PadSpan HA needs before you install it: a Home Assistant, a machine with enough memory, at
least one Bluetooth receiver, and something for each person to carry.

## Home Assistant

PadSpan HA needs **Home Assistant 2024.8 or newer**.

- On Home Assistant 2026.11 and newer, install it from **Settings → Marketplace**.
- On older versions, install it with HACS.

See [chapter 3](03-install-update-uninstall.md) for both.

Your rooms are Home Assistant's **areas**, and your floors are its **floors**. Set them up in
**Settings → Areas, labels & zones** before you start; PadSpan reads them from there. A house with
one floor needs no floors at all.

Uploading a floor plan, setting its scale, starting the trial, backups and anything that sends data
out of the house need a Home Assistant **administrator**. A new install also has **Enhanced
security** on: every change to PadSpan's shared setup then needs an administrator, while the rest of
the household can still look and use it.

## The machine Home Assistant runs on

| | |
|---|---|
| **Recommended** | **More than 2 GB of memory.** A Raspberry Pi 4 or 5 with 4 GB or more, a Home Assistant Green, or any mini PC or virtual machine with 4 GB or more. |
| **2 GB machines** | Not recommended for now. If you have one, turn on **Low-memory mode** (below). Near a busy street or in an apartment block, PadSpan hears thousands of passing Bluetooth devices, and a 2 GB Raspberry Pi has run out of memory within a few hours. |
| **Storage** | **An SSD or eMMC rather than an SD card.** PadSpan saves its device history to disk up to every 15 seconds. |

PadSpan keeps every device it hears for a while, not only the ones you follow. In a quiet house that
is a few hundred. Next to a busy street it can be tens of thousands, and that is what costs memory.

### Low-memory mode

**Settings → Tracking → Performance → Low-memory mode**, off by default. It holds fewer passing
devices, and for less time:

| | Normally | With Low-memory mode |
|---|---|---|
| How long PadSpan remembers an address it heard | The BLE Advertisement Timeout (4 hours unless you change it) | 15 minutes at most |
| Addresses remembered | No limit | 2,000 |
| Unnamed devices in the device history | 10,000, for 1 to 14 days | 2,000, for 1 day |
| Bluetooth adverts sent to the panel | 5,000 | 2,000 |

It changes nothing else. Your named, labelled and followed devices are never dropped, and rooms,
positions, the Atlas and Live Aboard work as before. Passing strangers just drop out of the lists
sooner. The card asks before it turns on.

The measured memory figures, device by device, are in [Minimum requirements](../MINIMUM_REQUIREMENTS.md).

## Bluetooth receivers

PadSpan listens through Bluetooth receivers (also called Bluetooth proxies or scanners). You need at
least one:

- **One receiver** tells home from away.
- **One in each room you want told apart** gives you rooms. A room with no receiver of its own can
  still be told apart once you have a map with three or more receivers placed on it.

Each receiver needs a Home Assistant **area**: that is its room. A receiver with no area gives no
room, however well it hears you. [Chapter 4](04-first-room.md) shows where to set it.

PadSpan uses these kinds. You can mix them.

| Receiver | What you do |
|---|---|
| **ESPHome Bluetooth proxy** (an ESP32 board) | Nothing more: Home Assistant's Bluetooth hands PadSpan what it hears. A board with an external antenna is better than one with a chip antenna. |
| **Shelly, Gen2 or newer** | Set it as a Bluetooth scanner, in the Shelly's own settings: [Shelly as a Bluetooth proxy](https://padspan.traks.ca/guides/shelly-bluetooth-proxy/). Home Assistant then passes it to PadSpan like an ESPHome proxy. |
| **The Home Assistant machine's own Bluetooth**, or a USB Bluetooth adapter | Nothing more, once Home Assistant's Bluetooth integration has it. |
| **ESPresense** nodes | They come in over MQTT. They need Home Assistant's MQTT integration, and PadSpan's **Manage → HA Entities → ESPresense MQTT → Enable ESPresense MQTT ingestion** switched on. |
| **Tasmota** on an ESP32 (experimental) | Over MQTT too: Home Assistant's MQTT integration, and **Manage → HA Entities → Tasmota BLE → Read Tasmota BLE over MQTT**. In each Tasmota's console, type `TelePeriod 10`, `BLEMaxAge 30` and `BLEAddrFilter 1`. Without them, Tasmota reports too slowly for rooms, and never reports phones and tags that change address. |

**Shellys and other passive receivers on Home Assistant 2026.4 or newer:** if they show no signal
during calibration, switch on **Refresh every 5 s for passive proxy scanners**, in
**Settings → Tracking → Receivers → Bluetooth refresh interval**.

**Already running Bermuda?** Keep it. PadSpan uses the same proxies and leaves Bermuda as it is:
[Bermuda and PadSpan together](https://padspan.traks.ca/guides/bermuda/).

How many you need, and where to put them: [How many Bluetooth proxies do I need?](https://padspan.traks.ca/guides/bluetooth-proxies/)

## Something to carry

PadSpan follows what each person carries. Each kind needs one thing done once:

| What | What it needs |
|---|---|
| **Android phone** | The Home Assistant Companion app, with its **BLE Transmitter** sensor on. PadSpan can switch it on for you. |
| **iPhone, iPad or Apple Watch** | Its key, the IRK, in Home Assistant's Private BLE Device integration, once. A spare ESP32 running irk-capture is one way to get it. |
| **A beacon or key tag with a fixed address** | Nothing: name it in PadSpan and the name sticks. |
| **AirTag, Samsung SmartTag** | These change address with no key to read. AirTags work only in part, with the experimental **MAC Rotation Bridging** (Settings → Features); SmartTags not reliably. |

[Which room is my phone in?](https://padspan.traks.ca/guides/phone-room-presence/) has the phone
steps, and [Which Bluetooth tag works?](https://padspan.traks.ca/guides/bluetooth-tags/) the tags.

## A screen to look at it on

| | |
|---|---|
| **The panel** | Any current browser: Chrome, Edge, Safari or Firefox, on a computer, tablet or phone, or the Home Assistant app. |
| **The Atlas** | The same. A wall tablet that runs Home Assistant's dashboards smoothly runs the Atlas. |
| **Live Aboard** (the 3D house, Pro) | A browser with **WebGL 2**. Without it, or on a graphics chip too slow for it, PadSpan shows the flat Atlas instead, and says so. |

## A floor plan (optional)

You don't need one to start: rooms come from your receivers' areas. A plan adds the map, and lets
PadSpan place devices between receivers. Any picture of a floor works, even a photo of a sketch. No
picture at all? A blank floor of the size you type, a phone's room scan or a robot vacuum's map also
work. See [chapter 9](09-setup-the-map.md).

## The internet

The tracking needs none. PadSpan goes online only for: its daily update check (it can be turned
off), a licence key's daily check, the AI features you switch on, and the usage report if you opt
in. See [Updates & Privacy](../../README.md#updates--privacy).
