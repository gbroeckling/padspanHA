# Minimum requirements

What PadSpan HA needs from the machine running Home Assistant and from the screen you look at it on. This page will be updated as numbers come in from installs that have opted in to [Help improve PadSpan](../README.md#help-improve-padspan-opt-in-usage-report). Read it before you buy Pro: it says plainly what a smaller machine can and cannot run.

## The Home Assistant machine

| | |
|---|---|
| **Recommended** | **More than 2 GB of RAM.** A Raspberry Pi 4 or 5 with 4 GB or more, a Home Assistant Green, or any mini PC or VM with 4 GB or more. |
| **2 GB machines** | **Not recommended for now; if you have one, turn on low-memory mode** (below). Near a busy street or in an apartment block, PadSpan hears thousands of passing Bluetooth devices. On a 2 GB Raspberry Pi, Home Assistant has been seen running out of memory within a few hours. See the measured numbers below. |
| **Storage** | **An SSD or eMMC rather than an SD card.** The object history is saved to disk up to every 15 seconds. In a house with about 2,900 devices that file is about 5 MB, which is up to about 30 GB of writes a day. |

### Why a busy street costs memory

PadSpan keeps three things in memory that grow with every device it hears, not only the ones you track:

- **The object history.** Every device it hears that is not a rotating phone address is kept for a day by default, so it shows in the device list (Settings → Presence → object history: 1, 2, 7 or 14 days). Tagged and identified devices are always kept. Since 0.38.106 it keeps at most 10,000 devices nobody has identified; past that, the ones heard longest ago go first.
- **The Bluetooth cache.** The last reading from every scanner for every address, kept for the BLE Advertisement Timeout (Settings → Presence; 4 hours unless you change it).
- **The live snapshot.** Everything above, built into one list that is sent to every open PadSpan panel every 5 seconds.

In a quiet house these hold a few hundred devices. Next to a busy street they can hold tens of thousands. One opted-in install reported over 80,000.

### What it costs, measured

On the developer's house (about 2,900 devices in the history, 19 scanners), every open PadSpan panel is sent about 5 MB every 5 seconds, and PadSpan's devices take about 40 MB of Home Assistant's 1.1 GB.

Benchmarked on 64-bit Python, the same kind a Raspberry Pi 4 or 5 runs, with six scanners. These are estimates: real memory use runs about 10 to 30% higher.

| Devices held | PadSpan's memory (held / peak with a panel open) |
|---|---|
| 1,000 | about 14 / 20 MB |
| 5,000 | about 67 / 100 MB |
| 25,000 | about 340 / 500 MB |
| 80,000 | about 1.0 / 1.6 GB |

A 2 GB Raspberry Pi has an estimated 0.4 to 0.8 GB left for PadSpan once Home Assistant OS, the Supervisor and a few add-ons are running. So PadSpan fits on 2 GB only if it holds about 5,000 devices or fewer. The measurements also show that capping the device list alone is not enough: the Bluetooth cache has to be capped too.

### Low-memory mode

**Settings → Presence → Low-memory mode**, off by default, since 0.38.106. For a 2 GB machine: it caps how many passing devices PadSpan holds.

| | Normally | With low-memory mode |
|---|---|---|
| How long the Bluetooth cache keeps an address | The BLE Advertisement Timeout (4 hours unless you change it) | 15 minutes at most |
| Addresses in the Bluetooth cache | No limit | 2,000 |
| Unidentified devices in the object history | 10,000, for 1 to 14 days | 2,000, for 1 day |
| Advertisements in the live snapshot | 5,000 | 2,000 |

Together that is about 4,000 devices at most, inside the roughly 5,000 a 2 GB machine was measured to fit.

**What it turns off:** passing devices nobody has identified drop out of the device list and the Monitor's advertisement list sooner. Nothing else. Your tagged, labelled and followed devices are never dropped, and positioning, the Atlas and Live Aboard are not changed by it. Whether the Atlas and Live Aboard run well on a 2 GB machine is still being measured from opted-in installs; until there is enough of it, more than 2 GB stays the recommendation.

The card in Settings lists the same limits, and asks before it turns on.

## The screen

| | |
|---|---|
| **The panel** | Any current browser: Chrome, Edge, Safari or Firefox, on a computer, tablet or phone. |
| **The Atlas** | The same. A wall tablet that runs Home Assistant's dashboards smoothly runs the Atlas. |
| **Live Aboard (the 3D house, Pro)** | A browser with **WebGL 2**. Without it, or on a graphics chip too slow to keep up, PadSpan shows the flat Atlas instead, and says so. |

How smoothly each kind of screen runs the Atlas and Live Aboard is being measured now, from installs that opted in to the usage report: frame rate and browser memory by view, grouped by the device's memory and CPU class. This section will give device guidance once there is enough of it.

## Bluetooth scanners

At least one: a Home Assistant Bluetooth proxy (ESPHome), a Bermuda proxy, or ESPresense nodes. ESPresense also needs Home Assistant's MQTT integration, with ingestion switched on in Manage.

## How these numbers are gathered

Only from installs that turned on **Settings → Presence → Help improve PadSpan**. Since 0.38.103 that report includes what PadSpan holds in memory, how fast new devices arrive, how often Home Assistant restarted or crashed, and how hard Home Assistant and each screen work while the Atlas or Live Aboard is showing. These are counts and buckets only. The full list of what is sent is in the [README](../README.md#help-improve-padspan-opt-in-usage-report).
