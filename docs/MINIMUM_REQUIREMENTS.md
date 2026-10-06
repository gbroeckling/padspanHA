# Minimum requirements

What PadSpan HA needs from the machine running Home Assistant and from the screen you look at it on. This page will be updated as numbers come in from installs that have opted in to [Help improve PadSpan](../README.md#help-improve-padspan-opt-in-usage-report). Read it before you buy Pro: it says plainly what a smaller machine can and cannot run.

## The Home Assistant machine

| | |
|---|---|
| **Recommended** | **More than 2 GB of RAM.** A Raspberry Pi 4 or 5 with 4 GB or more, a Home Assistant Green, or any mini PC or VM with 4 GB or more. |
| **2 GB machines** | **Not recommended for now.** Near a busy street or in an apartment block, PadSpan hears thousands of passing Bluetooth devices. On a 2 GB Raspberry Pi, Home Assistant has been seen running out of memory within a few hours. |
| **Storage** | PadSpan's stores are small. The object history grows with how busy the radio environment is. |

### Why a busy street costs memory

PadSpan keeps three things in memory that grow with every device it hears, not only the ones you track:

- **The object history.** Every device it hears that is not a rotating phone address is kept for a day by default, so it shows in the device list (Settings → Presence → object history: 1, 2, 7 or 14 days). Tagged and identified devices are always kept.
- **The Bluetooth cache.** The last reading from every scanner for every address, kept for 4 hours.
- **The live snapshot.** Everything above, built into one list that is sent to every open PadSpan panel every 5 seconds.

In a quiet house these hold a few hundred devices. Next to a busy street they can hold tens of thousands. One opted-in install reported over 80,000.

### Low-memory mode (being built)

A low-memory switch is being built for 2 GB machines. It will force a safe maximum number of objects instead of offering every option.

**It will turn things off.** When you switch it on, a large warning will list exactly what is disabled. This page will list the same things before the switch ships, including whether the Atlas and Live Aboard (the 3D house) stay available on a 2 GB machine. If you are on a 2 GB machine and thinking about Pro, wait for that list, or use a machine with more than 2 GB.

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
