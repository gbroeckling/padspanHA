# PadSpan Bright

**A lighting map for Home Assistant.** Every light in your house on an
isometric plan of your floors and rooms — tap to switch, drag to place, drawn
the way an electrician draws a lighting plan.

PadSpan Bright is the lighting half of [PadSpan HA](https://github.com/gbroeckling/padspanHA),
on its own, with none of the room-presence machinery showing. It is generated
from the PadSpan HA source at every release, so it is never behind and never
different: same code, same fixes, same version number.

[![Open your Home Assistant instance and add PadSpan Bright to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gbroeckling&repository=padspanBright&category=integration)

## What you get

**PadSpan Bright (no key)** — floors, rooms and one marker per light,
clustered in its room. Tap a marker or a row to toggle the light. Hide the
lights you never want on the map.

**PadSpan Bright Pro (key)** — place each light where it really is; set its
shape (pot, strip, pendant, sconce, fan…), size and angle in real units; use
WLED series and effects; and open Showcase, Fit room, Isolux, Scene and Ripple.

A **PadSpan Pro** key unlocks all of the same — one key, either download.

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
