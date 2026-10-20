# Walls Guide: materials and signal loss

Walls you draw in **Mapping → Edit → RF Barriers** tell PadSpan how much Bluetooth signal a wall
eats on its way from a phone or tag to a receiver. That's what keeps a phone in the kitchen from
being counted in the room behind the kitchen wall.

## Where the numbers come from

Each material is one number, in dB (more dB = more signal lost going through it):

| Material | PadSpan uses | What it's for |
|---|---|---|
| Open (Loft) | 0 dB | No wall: an opening to the floor above or below. In Live Aboard, an open edge over a hall that rises past it (a mezzanine, a gallery) gets a railing |
| Brick | 4 dB | A single brick or block wall |
| Custom | 6 dB, or what you set | Anything else. **This is PadSpan's "don't know" wall**; a wall with no material is treated as Custom 6 dB |
| Concrete | 8 dB | Poured concrete, foundation walls |
| Metal | 12 dB | Steel doors, metal studs, foil-backed insulation, wire-mesh plaster |
| Enclose (3 dB walls) button | 3 dB | Thin interior walls, drawn round a room in one go |

These are **round starting numbers, not measurements of your house**. They're deliberately on the
gentle side: Bluetooth gets round a lot of walls through doorways, gaps and ceilings, so the loss
PadSpan sees is usually less than what the wall alone would cost.

Floors are different: each floor slab starts at 10 dB, and PadSpan **learns** the real figure for
each pair of floors from your own data once it has enough. Walls aren't learned yet, so it's the number you pick.

## Is my house anywhere near that?

Figures commonly quoted in Wi-Fi planning at 2.4 GHz (the band Bluetooth uses) give a feel for it.
They vary a lot with thickness, moisture and what's inside the wall:

| Real wall | Roughly |
|---|---|
| Drywall / plasterboard on wood studs | 2–4 dB |
| Wooden door, ordinary window | 2–4 dB |
| Brick, single course | 6–10 dB |
| Concrete block | 6–12 dB |
| Poured concrete, stone | 10–20 dB or more |
| **Old plaster on wire (metal) lath** | 10–20 dB, sometimes much more |
| Low-E / coated window glass | 10–30 dB |
| Metal: steel doors, foil insulation, fridge, ductwork | 15–30 dB or more |

Old buildings catch people out in two ways:

- **Plaster and lath.** Wooden lath is fairly harmless. Expanded metal lath (common from the
  1920s on, and in repairs) acts like a screen. If a wall like that sits between two rooms that keep
  swapping devices, draw it as **Metal**, or **Custom** at 12–20 dB.
- **Thick masonry.** A solid stone or double-brick wall is closer to **Concrete** or Custom 10–15
  than to Brick.

You don't need every wall. Draw the ones between rooms that get mixed up, and the outside walls if
neighbours' phones show up inside.

## Custom: setting your own number

Pick **Custom** in the Material list and a **Loss through it** box appears (0–30 dB). Set it before you draw; every wall drawn after that gets that number until you change it.

## A receiver that hears the neighbours

Walls only help if they're between the phone and the receiver. A receiver on an outside wall, or on
a floor above a shop or a flat, also hears the street and the people downstairs. For that one
receiver, **Bluetooth → Scanners → Min signal** (off unless you set it) ignores anything it hears
weaker than the level you pick, say -90 on an outside wall or -80 by a front door:

- Positioning and Occupancy's phone count stop counting those faint readings from that receiver.
- Everything else still sees them: the scanner and advert lists, Forensics, Traceback, Find My
  following and calibration.
- A phone in the room reads far stronger than that at the nearest receiver, so it isn't lost.

## How to tell a wall is wrong

- **A phone or tag sticks to the room on the other side of a wall:** the wall is weaker in the map
  than in real life. Go one step up (Brick → Concrete → Metal), or Custom with a bigger number.
- **A device in the room can't seem to "see" the receiver right beside it:** there may be a wall
  drawn between them that shouldn't be there, or one that's much too strong.
- **Calibration helps either way.** Calibrating each receiver (Calibration → Pin & Listen) fits how
  fast signal fades in your house, which soaks up a lot of what the walls don't get right.

See also the [Atlas Guide](ATLAS_GUIDE.md) and [Getting Started](GETTING_STARTED.md).
