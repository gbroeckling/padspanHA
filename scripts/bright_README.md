# PadSpan Bright

**A lighting map for Home Assistant.** Every light, fan, motion and
temperature sensor, lock, and door or window in your house on an isometric
plan of your floors and rooms — tap to switch, drag to place, drawn the way
an electrician draws a lighting plan.

PadSpan Bright is the lighting half of [PadSpan HA](https://github.com/gbroeckling/padspanHA),
on its own, with none of the room-presence machinery showing. It is generated
from the PadSpan HA source at every release, so it is never behind and never
different: same code, same fixes, same version number.

[![Open your Home Assistant instance and add PadSpan Bright to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gbroeckling&repository=padspanBright&category=integration)

## Screenshots

|                                                                                                                                        |                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Floors and rooms drawn as an isometric plan](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/bright-overview.jpg) | ![A light placed at its real width, length and rotation in centimetres](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/bright-fixture-editor.jpg) |
| The floor plan — every light on your real rooms, not a list.                                                                          | Real size and angle, in centimetres, not a dot.                                                                                                     |

![The control card a WLED strip opens on long-press: on/off, brightness, colour and effect, live against the real device](https://raw.githubusercontent.com/gbroeckling/padspanHA/main/images/bright-wled-card.png)

Long-press a light on the map for its full card — this one's a WLED strip mid-effect.

## What you get

**PadSpan Bright (no key)** — floors, rooms and one marker per light,
clustered in its room. Tap a marker or a row to toggle the light. Hide the
lights you never want on the map.

**PadSpan Bright Pro (key)** — place every light, fan, motion sensor,
temperature sensor and lock exactly where it really is; set shape (pot,
strip, pendant, sconce, fan…), size and angle in real units; place WLED
strips and control their brightness, colour and effects live from the map;
mark a door or window on a wall and see it open or closed live on the map,
with closed doors modelled as real RF barriers (steel doors block harder than
hollow-core); and turn on Automorph, which grows a soft aura from each
fixture into its room (Glow, Blueprint or Nebula style).

Every motion sensor's flash and fade run through the same normalizer no
matter the hardware underneath — an alarm-panel PIR that self-clears in 5
seconds and a radar sensor that holds "on" for 20 minutes both read the same
way on the map: a 5-minute flash, then a graduated fade through six colours
the longer it's been quiet.

A **PadSpan Pro** key unlocks all of the same — one key, either download.

| Feature                                                             | Bright (free) | Bright Pro |
| --------------------------------------------------------------------- | :-----------: | :--------: |
| Floors & rooms drawn as an isometric plan                             |       ✓       |     ✓      |
| One marker per light, tap (or its row) to toggle                       |       ✓       |     ✓      |
| Hide lights you don't want cluttering the map                         |       ✓       |     ✓      |
| Place each light at its real position on the floor plan                 |               |     ✓      |
| Real shape, size (width × length) and rotation                         |               |     ✓      |
| WLED strip/series placement, sized and angled to the strip              |               |     ✓      |
| Brightness, colour and effect control per light, live                  |               |     ✓      |
| Fans, motion sensors, temperature sensors and locks placed on the map      |               |     ✓      |
| Doors & windows linked to a wall, live open/closed state on the map     |               |     ✓      |
| Closed doors modelled as real RF barriers (material-aware attenuation) |               |     ✓      |
| Motion flash/fade normalized across every sensor's hardware hold time   |               |     ✓      |
| Automorph room-aura rendering (Glow / Blueprint / Nebula)               |               |     ✓      |
| Import an existing house from PadSpan Bright into PadSpan HA          |       ✓       |     ✓      |

## Install

Use the button above, or open HACS → Integrations → ⋮ → **Custom repositories** and add
   `https://github.com/gbroeckling/padspanBright` as an *Integration*.

Then:

1. Install **PadSpan Bright** and restart Home Assistant.
2. Open Settings → Devices & services → **Add integration** → PadSpan Bright.
3. Open **PadSpan Bright** in the sidebar: draw your floors and rooms under
   Mapping, then turn on the **Lights** sidebar panel in Settings.

Home Assistant 2024.1 or newer. No hardware needed — it reads your `light.*`
entities and their room assignments from Home Assistant.

## Already running PadSpan HA?

You do not need this. PadSpan HA contains everything here — the same Lights
tab, the same sidebar panel — and a PadSpan Pro key unlocks it there.

## Moving from Bright to PadSpan HA

Install PadSpan HA alongside; its Health tab offers **Import from PadSpan
Bright** when it finds Bright's data. Your floors, rooms and every placed
light come across; then remove Bright.

## Privacy

Once a day PadSpan Bright asks `padspan.traks.ca` whether a newer version exists, sending only its version number (turn it off under Settings → Update Check). Separately there is an **opt-in, off-by-default** usage report — **Settings → Help improve PadSpan** — that sends counts, versions and flags only (how many floors, rooms and lights; which features are on; which tabs were used; a few health flags) and never addresses, keys, names, coordinates or timestamps. **Preview what would be sent** shows the exact report before you decide; the code refuses to send anything identifier-shaped.

## Documentation, issues, licence

Documentation and the [issue tracker](https://github.com/gbroeckling/padspanBright/issues)
live here. The source is generated from PadSpan HA at release time. GNU GPL v3.0,
© 2026 Garry Broeckling.
