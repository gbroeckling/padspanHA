# 1. What PadSpan is

[Contents](README.md)

PadSpan HA is a Home Assistant integration for Bluetooth room presence. It listens to the Bluetooth
receivers your Home Assistant already has (ESPHome Bluetooth proxies, Shellys, the machine's own
Bluetooth, ESPresense or Tasmota), works out which room each phone, watch, tag and beacon is in,
every 5 seconds, and gives your automations a room, a distance and home or away for each one you
name. It runs on your Home Assistant: the tracking needs no cloud.

PadSpan has its own page in Home Assistant's sidebar. There you see who is where, follow one device,
replay where it went, and, if you want, draw your house on a floor plan so you see it all on a map.

You can try it before installing: [padspan.traks.ca/demo](https://padspan.traks.ca/demo/) is the
real panel on a sample house, in your browser.

## What you get for free

PadSpan HA is free and open source (GPL v3). With no key, you get:

- **Rooms with no floor plan.** Each receiver's room is its Home Assistant area. A device goes to the
  room whose receiver hears it best. The Overview's **Who's where now** card lists each room and who
  is in it.
- **Entities for your automations.** Each device you name gets a device tracker (its state is the
  room, or `not_home`), an area sensor and distance sensors. Events fire when a named device arrives,
  leaves or changes room. See [chapter 14](14-home-assistant-reference.md).
- **A map of your house.** Upload a floor plan (or start without one), set its scale, draw your
  rooms and place your receivers. With three or more receivers placed on a plan with a scale,
  PadSpan also places devices between them, even in a room with no receiver of its own.
- **Calibration.** Walk the house with your phone so PadSpan learns what each spot really sounds like.
- **Follow**, with alerts by phone or email when a device changes room, arrives or leaves.
- **Traceback**, a replay of where devices went, with **Insights** (time in each room).
- **Occupancy**, an estimate of how many people are in the building.
- **The Atlas**, the lighting map of your house: every light on its floor and in its room, with a
  tap to switch it.

## What PadSpan Pro adds

A licence key unlocks the paid parts on the same install. Nothing to reinstall, nothing to set up
again.

| Edition | Key | What it is |
|---|:---:|---|
| **PadSpan HA** | none | Room presence, plans, calibration, movement history and the sensors for your automations. Free. |
| **PadSpan Pro** | `pro` | Everything above, plus: exact placement on the Atlas (each light's shape, size and angle, WLED, Automorph, Showcase), Live Aboard (your house in 3D, experimental) with Furnish, the wall screen, Whole house presets and Vacation Mode, Forensics, Busy Times, Locate, and the Graphite, Ocean, Dusk and Day themes. |
| [**PadSpan Bright**](https://github.com/gbroeckling/padspanBright) | none | A separate, lighter download made from the same code: only the Atlas, for a house that wants its lights on a map and no presence tracking. |
| **PadSpan Bright Pro** | `bright` | Bright's full Atlas tools (placement, shapes, WLED, Automorph, Showcase), on a Bright install. Sold until December 15, 2026. |

A PadSpan Pro key also unlocks Bright's tools, if you install Bright instead.

When a key runs out, nothing you set up is deleted. Light placement goes read-only, Forensics stops
recording (what it recorded stays for its retention time), and the 3D house, the wall screen, Locate
and Busy Times switch off. It all comes back as you left it when you renew.

### The free trial

With no key on the install, **Settings → Features → PadSpan licence** has **Start 90-day free
trial**: all of Pro for 90 days, no card, one trial per home. An administrator starts it. It needs
the usage report on, and the report stays on until the trial ends. Keys and prices are on
[padspan.traks.ca](https://padspan.traks.ca). The trial, keys, homes and testers are explained in
[chapter 25](25-padspan-pro.md).

## Is it for me?

PadSpan is a good fit if:

- **You want to know which room someone is in**, not only whether they are home. That needs a
  receiver in each room you want told apart. One receiver tells home from away and nothing more.
- **You already have Bluetooth proxies**, or Shellys (Gen2 or newer), or can put an ESP32 board in a
  few rooms. PadSpan uses what Home Assistant already hears. It needs no firmware of its own.
- **The people you want to follow carry a phone, a watch or a tag.** An Android phone with the Home
  Assistant Companion app works after one switch in the app. An iPhone or Apple Watch needs its key
  (the IRK) once. A beacon or key tag with a fixed address works as soon as you name it.
- **You like to see it.** PadSpan shows who is where on a map of your house, and lets you replay it.

Think again, or start small, if:

- **You need to know exactly where someone stands.** Bluetooth gives a room, and with enough
  receivers a rough spot within it. Walls, bodies and furniture change the signal, so a device near
  a doorway can show in the room next door.
- **Your devices change their Bluetooth address and have no key you can get.** An AirTag, a Samsung
  SmartTag or a phone without the Companion app or its IRK can be heard but not told apart for long.
  PadSpan has an experimental switch for AirTags (MAC Rotation Bridging), but it can't promise them.
- **Your Home Assistant runs on a 2 GB machine near a busy street.** PadSpan hears every passing
  device. More than 2 GB of memory is recommended. See [chapter 2](02-requirements.md).
- **You want it outdoors, over a large garden or a farm.** Rooms come from receivers; outside, each
  area you want told apart needs its own.

You don't need a floor plan to start. Install it, give each receiver its area, and **Who's where
now** shows rooms the same day. [Chapter 4](04-first-room.md) walks through it.

## How it compares

[Bermuda](https://github.com/agittins/bermuda) and [ESPresense](https://espresense.com/) are both
good, and lots of people run them. This is what each does, from their own documents as of October
2026. If something here is out of date, [open an issue](https://github.com/gbroeckling/padspanHA/issues).

| | PadSpan HA | Bermuda | ESPresense (+ Companion) |
|:--|:--|:--|:--|
| Room-level presence | Yes | Yes | Yes |
| Hardware | ESPHome Bluetooth proxies, Shelly Gen2+, HA's own Bluetooth or a USB adapter, or ESPresense over MQTT once switched on | ESPHome Bluetooth proxies, Shelly Gen2+, USB adapters | Its own firmware on ESP32 nodes |
| Floor plan needed? | No: rooms come from each receiver's HA area; the map is optional | No | No for rooms; Companion's map needs your rooms as coordinates |
| Map of your home | Yes, rooms drawn on your floor plan | No | Yes, in Companion |
| Multi-floor 3D view | Yes (the full 3D house, Live Aboard, is Pro) | No (it has a floor sensor) | Yes, in Companion |
| Position between receivers | Yes, with 3 or more receivers placed on a plan with a scale | No | Yes, in Companion |
| Calibration | Walk-around fingerprints and a per-receiver signal fit | Guided: global, per proxy and per device | By hand on each node; automatic in Companion |
| iPhones and Apple Watches (IRK) | Yes, through Private BLE Device or irk-capture, with a setup guide | Yes, through Private BLE Device | Yes, enrolled on the node's web page |
| Tags that change address (AirTag, SmartTag) | Experimental | No | No (AirTags can only be counted) |
| Room, distance and tracker entities | Yes | Yes | A room sensor with distance; a tracker from Companion |
| Movement history | Playback (Traceback) | HA's own history | Path view in Companion |
| Alerts when a device changes room | Built in (Follow) | With your own automations | With your own automations |
| Where you set it up | A PadSpan page in the HA sidebar | Home Assistant's setup dialogs | The node's web page and the Companion app |

**Already running Bermuda?** Keep it. PadSpan runs beside it on the same proxies and leaves it as it
is: [Bermuda and PadSpan together](https://padspan.traks.ca/guides/bermuda/).

## What PadSpan never touches

PadSpan reads your other integrations and leaves them as they are. Installing, disabling or removing
it doesn't change another integration's devices, entities or settings. The only exceptions are
buttons you press yourself, one at a time: adding an iPhone's key to Private BLE Device, giving a
receiver its area, switching on a phone's BLE Transmitter sensor, and Manage's delete buttons. The
[README](../../README.md#what-padspan-never-touches) has the full list, and what leaves the house is
under [Updates & Privacy](../../README.md#updates--privacy).
