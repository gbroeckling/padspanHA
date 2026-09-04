# PadSpan Bright

**A lighting map for Home Assistant.** Every light in your house on an
isometric plan of your floors and rooms — tap to switch, drag to place, drawn
the way an electrician draws a lighting plan.

PadSpan Bright is the lighting half of [PadSpan HA](https://github.com/gbroeckling/padspanHA),
on its own, with none of the room-presence machinery showing. It is generated
from the PadSpan HA source at every release, so it is never behind and never
different: same code, same fixes, same version number.

## What you get

**PadSpan Bright (no key)** — floors, rooms and one marker per light,
clustered in its room. Tap a marker or a row to toggle the light. Hide the
lights you never want on the map.

**PadSpan Bright Pro (key)** — the whole lighting product: place each light
where it really is; give it its shape (pot, strip, pendant, sconce, fan…),
its size and its angle in real units; WLED strips get their own series and
their effects dialog; Showcase renders the house lit in each fixture's own
colour and brightness; Fit-to-room and Hide-untouched for presentation.

A **PadSpan Pro** key unlocks all of the same — one key, either download.

## Install

1. HACS → Integrations → ⋮ → **Custom repositories** → add
   `https://github.com/gbroeckling/padspanBright` as an *Integration*.
2. Install **PadSpan Bright**, restart Home Assistant.
3. Settings → Devices & services → **Add integration** → PadSpan Bright.
4. Open **PadSpan Bright** in the sidebar: draw your floors and rooms under
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

Once a day PadSpan Bright asks `padspan.traks.ca` whether a newer version exists, sending only its version number (turn it off under Settings → Update Check). Separately there is an **opt-in, off-by-default** usage report — **Settings → Help improve PadSpan** — that sends counts, versions and flags only (how many floors, rooms and lights; which features are on; which tabs were used; a few health flags) and never addresses, keys, names, coordinates or timestamps. **Preview what would be sent** shows the exact report before you decide; the code refuses to send anything identifier-shaped. The full field list is in the PadSpan HA README.

## Documentation, issues, licence

Documentation and the issue tracker live in the
[PadSpan HA repository](https://github.com/gbroeckling/padspanHA) — this one
is generated. GNU GPL v3.0, © 2026 Garry Broeckling.
