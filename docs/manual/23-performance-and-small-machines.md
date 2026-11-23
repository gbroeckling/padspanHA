# 23. Performance and small machines

[Contents](README.md)

What PadSpan costs the Home Assistant machine and the screens, and what to turn on when either
struggles. The short version of the requirements is in [chapter 2](02-requirements.md).

## The Home Assistant machine

| | |
|---|---|
| **Recommended** | More than 2 GB of memory: a Raspberry Pi 4 or 5 with 4 GB or more, a Home Assistant Green, or a mini PC or virtual machine with 4 GB or more. |
| **2 GB machines** | Not recommended for now. If you have one, turn on **Low-memory mode** (below). |
| **Storage** | An SSD or eMMC rather than an SD card. The device history is saved up to every 15 seconds: in a house with about 2,900 devices that file is about 5 MB, up to about 30 GB of writes a day. |

## Why a busy street costs memory

PadSpan keeps every device it hears for a while, not only the ones you follow. Three things grow
with them:

- **The device history**: every device heard that isn't a phone's changing address, kept for a day by
  default (**Settings → Tracking → What the panel shows → Object History Retention**: 1, 2, 7 or 14
  days), at most 10,000 that nobody has named. Named and followed devices are always kept.
- **The Bluetooth cache**: the last reading from every receiver for every address, kept for the
  **BLE Advertisement Timeout** (same section; 4 hours unless you change it).
- **The live picture**: all of that built into one list for every open PadSpan screen, every
  5 seconds.

In a quiet house that is a few hundred devices. Next to a busy street or in a block of flats it can
be tens of thousands; one house reported over 80,000.

**Measured** on 64-bit Python with six receivers (real use runs 10 to 30% higher):

| Devices held | PadSpan's memory (held / peak with a screen open) |
|---|---|
| 1,000 | about 14 / 20 MB |
| 5,000 | about 67 / 100 MB |
| 25,000 | about 340 / 500 MB |
| 80,000 | about 1.0 / 1.6 GB |

A 2 GB Raspberry Pi has about 0.4 to 0.8 GB left for PadSpan once Home Assistant OS and a few add-ons
run, so it fits only about 5,000 devices.

## Low-memory mode

**Settings → Tracking → Performance → Low-memory mode**, off by default. For a 2 GB machine: it caps
how many passing devices PadSpan holds.

| | Normally | With Low-memory mode |
|---|---|---|
| How long the Bluetooth cache keeps an address | The BLE Advertisement Timeout (4 hours unless changed) | 15 minutes at most |
| Addresses in the Bluetooth cache | No limit | 2,000 |
| Unnamed devices in the device history | 10,000, for 1 to 14 days | 2,000, for 1 day |
| Adverts in the live picture | 5,000 | 2,000 |

Together that is about 4,000 devices at most. It changes nothing else: named, labelled and followed
devices are never dropped, and rooms, positions, the Atlas and Live Aboard work as before. Passing
strangers just drop out of the lists sooner. The card asks before it turns on.

## The other Performance settings

All in **Settings → Tracking → Performance**:

- **Presence Poll Interval** (5 seconds): how often rooms are worked out. Higher is lighter on the
  processor and slower to follow you.
- **CPU Mode**: where that work runs. **Shared** (the default) runs it with Home Assistant: fastest,
  and it competes with Home Assistant. **Single core** holds it to one core so Home Assistant stays
  responsive. **Dedicated core** gives it a core of its own. It applies from the next update, no
  restart.
- **Optimize for scale** (off): for several screens at once. The Overview and the 3D people get only
  what they draw (about 50 KB a screen instead of about 2.2 MB in a busy house), screens asking at the
  same moment share one build, and a hidden screen asks for nothing. Details in
  [chapter 18](18-wall-screens-and-kiosks.md#several-screens-at-once-optimize-for-scale).

On **Settings → Tracking → Receivers**, a longer **Bluetooth refresh interval** reads the receivers
less often (but keep 5 seconds for passive ones such as Shellys: [chapter 5](05-receivers.md)).

## The screens

| | |
|---|---|
| **The panel and the Atlas** | Any current browser: Chrome, Edge, Safari or Firefox, on a computer, tablet or phone. A tablet that runs Home Assistant's dashboards smoothly runs the Atlas. |
| **Live Aboard (the 3D house)** | A browser with WebGL 2. Without it, or on a graphics chip too slow to keep up, PadSpan shows the flat Atlas instead and says so. |

For a slow screen:

- set Live Aboard's **Quality** to Low (**Settings → Atlas → Live Aboard**). On Auto it drops by
  itself when the screen can't keep up;
- **Show the frame rate (this browser only)**, on the same card, shows how many times a second the
  house is drawn;
- the flat Atlas wall (`/padspan-lights?kiosk=1`) asks Home Assistant for the least.

With nothing changing, Live Aboard draws nothing, so an idle wall costs almost nothing.

## When Home Assistant is slow or runs out of memory

1. Turn on **Low-memory mode**.
2. Shorten **Object History Retention** to 1 day, and the **BLE Advertisement Timeout**.
3. With several wall screens, turn on **Optimize for scale**.
4. Try **CPU Mode → Single core**.

More, by symptom: [chapter 26](26-troubleshooting.md#home-assistant-runs-out-of-memory-or-is-slow).

## How these numbers are gathered

Only from installs that turned on **Settings → Tracking → Help improve PadSpan**: what PadSpan holds
in memory, how fast new devices arrive, how often Home Assistant restarted, and how hard Home
Assistant and each screen work. Counts and bands only ([chapter 24](24-privacy.md)). Guidance for
screens, by kind of device, will follow once there is enough of it.
