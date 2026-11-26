# 1. What PadSpan is

[Contents](README.md)

PadSpan HA is a control panel for your house, inside Home Assistant. It draws your floors and rooms,
puts each light, lock and sensor in its room, and, with Bluetooth receivers, shows which room each
person is in. A tap on a light switches it. A leak or smoke alarm turns its room red, and a red
banner shows it on every PadSpan screen. It can be as simple or complex as you need: start with
your rooms and their lights, add receivers for who's where, and add PadSpan Pro when you want more.

PadSpan has two pages in Home Assistant's sidebar. **PadSpan HA** is the whole panel: who is where,
**Follow** for one phone or tag, a replay of where devices went, setup and settings. **Atlas** is the
map of your house, made for a phone or a screen on the wall. PadSpan runs on your Home Assistant,
and the tracking needs no cloud.

You can try it before installing: [padspan.traks.ca/demo](https://padspan.traks.ca/demo/) is the
real panel on a sample house, in your browser. The demo shows PadSpan Pro, so it includes the paid
parts.

## What you get for free

PadSpan HA is free and open source (GPL v3). The free version needs no key and doesn't run out.
Some features need PadSpan Pro or an add-on. Many of them say so where you meet them, and the
licence card in **Settings → Features → PadSpan licence** lists each add-on with a link to what it
adds. Pro includes every add-on. With no key, you get everything below.

### Your house on one screen

These need only Home Assistant, with no Bluetooth receiver.

- **The Atlas**: your floors and rooms, with every light and fan in its room and a tap to switch it.
  Tap a room's name for its sheet: every device in it, **All lights on / off**, and a button for each
  of the room's scenes and scripts in Home Assistant (up to six). See [chapter 15](15-the-atlas.md).
- **Locks** on the map, with **Lock** and **Unlock** in their card. **Unlock** asks first.
- **Leak, smoke, gas and CO alarms** ring their room red and stay alarming for 2 days, or until
  someone resets them. A red banner shows them on every PadSpan screen, and you get one notification
  when one goes off and one when it clears ([chapter 13](13-alerts.md)).
- **A house alarm going off** (an alarm panel in Home Assistant, such as Alarmo) shows on the
  Atlas's emergency button and as a row in the red banner.
- **Alert pulse** (off until you turn it on): a door, window, gate or cover open for more than 6
  hours, or a window or cover open in the rain or snow, rings its room amber.
- **Rain and snow** round the house on the Atlas, drawn still, from your weather entity or a rain
  sensor.
- **Open screens** (off until you turn it on): every open PadSpan page in one list, to reload one or
  all, and, from an automation, a message with a chime on the screens you name
  ([chapter 14](14-home-assistant-reference.md#services)).
- **A kiosk link**, `/padspan-ha?kiosk=1`, hides PadSpan's menu for a tablet
  ([chapter 18](18-wall-screens-and-kiosks.md)). Wall mode on the Atlas page is PadSpan Pro's
  until December 1, 2026. From then the plain wall screen is free, and its night dimming and other
  extras stay Pro's.
- **The Night, Light and High contrast themes.** The panel speaks your Home Assistant language:
  English and German, and much of it French and Dutch.

### Your lights

These need only Home Assistant too.

- **Every light on the Atlas**, in its room, with a tap to switch it (above). From December 1,
  2026, each light and device can be placed exactly where it is, drawn as a plain marker.
- **Power teams**: a wall dimmer or switch and the smart bulbs it feeds become one light in Home
  Assistant. It follows the day, can wake you, and sets the bulbs again when the wall switch turns
  them back on ([chapter 15](15-the-atlas.md#power-teams)). Making or changing a team, following the
  day and the wake-up need Pro or the Advanced smart lighting add-on; a team already made keeps
  switching without it.

### Who's in which room

These need at least one Bluetooth receiver. One tells home from away; one in each room you want told
apart gives you rooms.

- **Rooms with no floor plan.** Each receiver's room is its Home Assistant area. A device goes to the
  room whose receiver hears it best. The Overview's **Who's where now** card lists each room and who
  is in it. **Set room** gives a receiver with no area its room, and **Track** starts tracking a phone
  Home Assistant already tells apart.
- **Entities for your automations.** Each device you name gets a device tracker (its state is the
  room, or `not_home`), an area sensor and distance sensors. Events fire when a named device arrives,
  leaves or changes room, and Assist can answer "Which room is Alex in?" once you add its sentences. See
  [chapter 14](14-home-assistant-reference.md).
- **Follow**, for one device: its room now and its movements, with alerts by phone or email when it
  changes room, arrives or leaves.
- **Live Tracker**, a full-screen live map, and **Occupancy**, an estimate of how many people are in
  the building.
- **Traceback**: 7 days of where your devices went, played back on your floors, with **Insights**
  (time in each room) and **New Objects** ([chapter 12](12-the-screens.md#traceback)).
- **Share a replay**: a 10 to 30 second clip of people moving through the house, with names hidden,
  made in your browser. Nothing is uploaded.
- **Yesterday at home** (off until you turn it on): one message each morning about the day before,
  with comings and goings, guests, the rooms empty longest and lights left on in empty rooms
  ([chapter 13](13-alerts.md#yesterday-at-home)).
- **Lights follow people**: a room's lights go on when someone with a named phone, watch or tag
  comes in, and off once the room has been empty for its delay. A light turned off by hand stays off
  until everyone has left ([chapter 14](14-home-assistant-reference.md#lights-follow-people)). Three
  Home Assistant blueprints do the same in your own automations.
- **Guest tags**: a small Bluetooth tag lent to a guest for their visit, with rooms they shouldn't go
  into and a report of the stay ([chapter 7](07-tags-and-beacons.md#guest-tags)).
- **Calibration**, including **Walk a room**: carry your phone round a room for about 90 seconds so
  PadSpan learns what it sounds like ([chapter 11](11-calibration.md#walk-a-room)).
- **Positions between receivers.** With three or more receivers placed on a plan with a scale,
  PadSpan also places devices between them, even in a room with no receiver of its own.

### Your floor plan, in any form

These need only Home Assistant.

- **A rough house from your Home Assistant rooms**: one box per area on a blank floor, from **Show
  what it will make** and **Make the rough house** ([chapter 9](09-setup-the-map.md#start-with-a-rough-house)).
- **Any plan you have**: a picture or a photo of a sketch, a PDF, a blank floor of a size you type, a
  plan file from Easy Floorplan, a DXF or a Floorplanner file, a Sweet Home 3D file, a room scan from
  an iPhone or iPad Pro with LiDAR (drawn to scale, nothing to measure), or a robot vacuum's map
  (experimental). See [chapter 9](09-setup-the-map.md). From December 1, 2026, a LiDAR scan needs Pro
  or the Advanced map creation add-on, and a robot vacuum's map Pro, the Robot vacuum add-on or a
  Bright Pro key.
- **Rooms, floors and heights**: draw each room, set each floor's height, and give a room its
  ceiling height and split level.
- **Walls and doors**: wall materials and open edges for the signal, and doors and windows on the
  walls, linked to their sensors ([chapter 10](10-walls-and-signal-loss.md)).
- **The Overview** draws your floors stacked as a house. The house in 3D, Live Aboard, is PadSpan
  Pro's until December 1, 2026, and free from then.

### Also free

- **Enhanced security** (on for a new install): only administrators change the shared setup, and
  everyone in the house can view and use it ([chapter 21](21-users-and-security.md)).
- **Backups and restore**, and Home Assistant's own backup carries all of PadSpan
  ([chapter 22](22-backup-restore-moving.md)).
- **Training**, the animated walkthroughs, and the help inside PadSpan (the **?** next to a heading).

## What PadSpan Pro adds

PadSpan Pro is one key on the same install, with nothing to reinstall and nothing to set up again.
It adds:

- **Every light and device exactly where it is**, in its real shape, size and angle, with Automorph,
  Showcase, WLED's Advanced controls and moving rain and snow ([chapter 15](15-the-atlas.md)).
  From December 1, 2026, placing them is free; the shapes and the rest stay Pro's.
- **Live Aboard**, your house in 3D, like looking into a house in The Sims: lit windows at night,
  rain and snow, the Studio sky, a walk through the house at eye height, and a view that flies to
  the doorbell, a door or an alarm. It is experimental ([chapter 16](16-live-aboard.md)). From
  December 1, 2026, the 3D house and the walk are free; rain and snow, people and the view that
  flies to an alarm stay Pro's.
- **Furnish**: furniture, stairs, floors and wall colours, devices that come alive when the real one
  runs, and a figure for each person ([chapter 17](17-furnish.md)).
- **Wall mode** on the Atlas page, and the Atlas's new layout, where each screen picks what it shows
  ([chapter 18](18-wall-screens-and-kiosks.md)). From December 1, 2026, the plain wall screen is
  free; night dimming, the burn-in shift, floors in turn and Fully Kiosk motion wake stay Pro's.
- **The Atlas as your Overview**, and people and tags on the map.
- **The AI helpers** that build the house from your floor plans ([chapter 19](19-ai-features.md)),
  also in the Advanced map creation add-on from December 1, 2026.
- **Every add-on** (below), and every new feature while the key runs.

One Pro key covers up to five homes (with more than two, each keeps its usage report on).

| Edition | Key | What it is |
|---|:---:|---|
| **PadSpan HA** | none | Everything in the free list above, and from December 1, 2026 exact placement of lights and devices on the Atlas, the plain wall screen and the 3D house (Live Aboard). No key, and it doesn't run out. |
| **PadSpan Pro** | `pro` | Everything above, plus: exact placement on the Atlas (each light's shape, size and angle, WLED, Automorph, Showcase), Live Aboard (your house in 3D, experimental) with Furnish, wall mode and the new layout, the Atlas as Overview, people on the map, the AI features, and every add-on. From December 1, 2026, placing, the plain wall screen and the 3D house are free; Pro keeps the shapes, Furnish, people, the 3D editor, the director, and the wall screen's night dimming, burn-in shift, floors in turn and Fully Kiosk motion wake. |
| **Add-ons** | `free`, with add-ons | One feature each, for an install without Pro: Audio, Alarm & security, Wi-Fi coverage, Climate & air quality (listed as Climate map in PadSpan 0.38.300 to 0.38.303), Full house activity (listed as Time travel in PadSpan 0.38.300 and 0.38.301), Vacation Mode & presets, Looks pack, Presence insights (Locate, Busy Times and Forensics) and Advanced smart lighting, and, from December 1, 2026, Advanced map creation and Robot vacuum. Each covers 2 years, on up to three homes ([chapter 25](25-padspan-pro.md#add-ons)). |
| [**PadSpan Bright**](https://github.com/gbroeckling/padspanBright) | none | A separate, lighter download made from the same code: only the Atlas, for a house that wants its lights on a map and no presence tracking. |
| **PadSpan Bright Pro** | `bright` | Bright's placement tools (placement, shapes, WLED's Advanced controls, Automorph, Showcase) and the alarm controls, on a Bright install. Sold until December 15, 2026. |

A PadSpan Pro key also opens Bright's tools, if you install Bright instead.

When a key runs out, it keeps working for 14 more days. After that, nothing you set up is deleted.
Placed lights keep their places and draw as plain markers, Forensics stops recording (what it
recorded stays for its retention time), and Furnish, the wall screen's extras, Locate and Busy Times
switch off. (Until December 1, 2026, light placement goes read-only and the 3D house and the wall
screen switch off.) It all comes back as you
left it when you renew.

### The free trial

With no key on the install, **Settings → Features → PadSpan licence** has **Start 90-day free
trial**: all of Pro for 90 days, every add-on included, no card, one trial per home. An administrator
starts it. It needs the usage report on, and the report stays on until the trial ends. Keys and
prices are on [padspan.traks.ca](https://padspan.traks.ca). The trial, keys, homes and testers are
explained in [chapter 25](25-padspan-pro.md).

### Just want one thing?

An add-on adds one feature to an install without Pro. One payment covers 2 years on up to three
homes, and one key carries every add-on you buy. PadSpan Pro includes all of them. What each one
adds: [chapter 25](25-padspan-pro.md#add-ons), and in more detail
[PadSpan Pro and the add-ons](../PADSPAN_PRO.md#just-want-one-thing-the-add-ons). They're sold at
[padspan.traks.ca/#addons](https://padspan.traks.ca/#addons).

## Is it for me?

PadSpan is a good fit if:

- **You want your house on one screen**: the lights in their rooms a tap away, the locks, and the
  alarms. That needs only Home Assistant, with no receiver.
- **You want to know which room someone is in**, not only whether they are home. That needs a
  receiver in each room you want told apart. One receiver tells home from away and nothing more.
- **You already have Bluetooth proxies**, or Shellys (Gen2 or newer), or can put an ESP32 board in a
  few rooms. PadSpan uses what Home Assistant already hears. It needs no firmware of its own.
- **Everyone you want shown in a room carries a phone, a watch or a tag.** An Android phone with the
  Home Assistant Companion app works after one switch in the app. An iPhone or Apple Watch needs its
  key (the IRK) once. A beacon or key tag with a fixed address works as soon as you name it.
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
| Multi-floor 3D view | Yes (the 3D house, Live Aboard, is free from December 1, 2026; Pro before) | No (it has a floor sensor) | Yes, in Companion |
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
