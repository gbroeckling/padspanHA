# 10. Walls and signal loss

[Contents](README.md)

A wall eats some of the Bluetooth signal on its way from a phone or tag to a receiver. Walls you
draw on the map tell PadSpan how much. That is what keeps a phone in the kitchen from being counted
in the room behind the kitchen wall, and the neighbours' phones out of your living room.

You don't need every wall. Draw the ones between rooms that get mixed up, and the outside walls if
neighbours' phones show up inside. Walls need a map with a scale ([chapter 9](09-setup-the-map.md)),
because they are stored in metres.

## Drawing a wall

1. Open **Mapping → Edit** and pick the **Signal walls** tool.
2. Pick the **Material** (below). Name the next wall if you like.
3. Click on the map to start the wall, click at each corner, and finish it. It is saved the moment
   you finish. **Undo point** takes back the last click; **Cancel drawing** drops it.

Every wall you draw gets the material that is picked, until you change it. The list starts on
**Metal**, the strongest, so pick the material first.

**Enclose (3dB walls)** draws thin 3 dB walls round the picked room in one go: good for ordinary
interior walls.

## The materials

Each material is one number, in dB: more dB, more signal lost going through it.

| Material | Loss | What it's for |
|---|---|---|
| **Open (Loft) — no wall** | 0 dB | No wall: an opening to the floor above or below, or a room edge with no wall on it. |
| **Brick** | 4 dB | A single brick or block wall. |
| **Custom** | 6 dB, or what you set | Anything else. A wall with no material counts as Custom 6 dB. |
| **Concrete** | 8 dB | Poured concrete, foundation walls. |
| **Metal** | 12 dB | Steel doors, metal studs, foil-backed insulation, plaster on wire mesh. |

Pick **Custom** and a **Loss through it** box appears (0 to 30 dB). Set it before you draw.

These are round starting numbers, not measurements of your house. They are on the gentle side on
purpose: Bluetooth gets round a lot of walls through doorways, gaps and ceilings, so the loss
PadSpan sees is usually less than the wall alone would cost.

**Floors are different.** Each floor between two places starts at 10 dB, and PadSpan learns the
real figure for each pair of floors from your own data once it has enough. Walls aren't learned:
it is the number you pick.

## Is my house anywhere near that?

Figures often quoted for Wi-Fi planning at 2.4 GHz, the band Bluetooth uses, give a feel for it. They
vary a lot with thickness, damp and what's inside the wall.

| Real wall | Roughly |
|---|---|
| Drywall or plasterboard on wood studs | 2–4 dB |
| Wooden door, ordinary window | 2–4 dB |
| Brick, single course | 6–10 dB |
| Concrete block | 6–12 dB |
| Poured concrete, stone | 10–20 dB or more |
| Old plaster on wire (metal) lath | 10–20 dB, sometimes much more |
| Low-E or coated window glass | 10–30 dB |
| Metal: steel doors, foil insulation, a fridge, ductwork | 15–30 dB or more |

Old houses catch people out twice:

- **Plaster on lath.** Wooden lath does little. Expanded metal lath (common from the 1920s on, and
  in repairs) acts like a screen. If a wall like that sits between two rooms that keep swapping
  devices, draw it as **Metal**, or **Custom** at 12 to 20 dB.
- **Thick masonry.** A solid stone or double-brick wall is nearer **Concrete** or Custom 10 to 15 than
  Brick.

## Open edges: rooms with no wall between them

A loft, or a kitchen and living room that are one open space: signal already passes where no wall
is drawn, but marking the edge open records it on the map, and the 3D house leaves the wall out
there.

- **Open edge: tap a room edge**: tap a room's edge on the map. Only the stretch it shares with the
  room next door opens; an edge with no neighbour opens whole.
- **Open all edges** gives every edge of the picked room an Open (0 dB) wall. It asks first.
- **Remove open edges** takes back the open edges this tool marked along the room.

A room's edges can be marked once its outline is saved. In Live Aboard, an open edge can have a
glass railing or none: the **Railing** button on its row ([chapter 16](16-live-aboard.md)).

## Doors and windows that open

A steel door blocks signal when it is shut and none when it is open. PadSpan can follow that with
the door's own sensor.

1. On a wall's row, choose **Door** (**Mark a door/window on this wall**).
2. Click the two ends of the door on the wall. **Pick again** starts over.
3. Choose its **Linked sensor**, a Home Assistant door or window sensor, and its
   **Door/window material** (it starts as the wall's own).
4. Choose **Create door/window**.

A **Metal** door or window loses its 12 dB while its sensor says open, and gets it back when shut.
PadSpan waits for two readings in a row before it changes, so a flickering sensor can't make rooms
jump. A door of any other material is shown open or shut on the maps and changes nothing for the
signal: ordinary doors and glass hardly block Bluetooth either way.

## A receiver that hears the neighbours

Walls help only when they are between the phone and the receiver. A receiver on an outside wall, or
on a floor above a shop or a flat, also hears the street and the people downstairs. For that one
receiver, **Bluetooth → Scanners → Min signal** (**Min signal: off** unless you set it) ignores
anything it hears weaker than the level you pick, say **Ignore < -90** on an outside wall or
**Ignore < -80** by a front door.

- Positioning and Occupancy's phone count stop using those faint readings from that receiver.
- Everything else still sees them: the receiver and advert lists, Forensics, Traceback and
  calibration.
- A phone in the room reads far stronger than that at its nearest receiver, so it isn't lost.

## How to tell a wall is wrong

- **A phone or tag sticks to the room on the other side of a wall**: the wall is weaker on the map
  than in real life. Go one step up (Brick, then Concrete, then Metal), or Custom with a bigger
  number.
- **A device in a room can't seem to hear the receiver right beside it**: there may be a wall drawn
  between them that shouldn't be there, or one much too strong.
- **Calibration helps either way.** It fits how fast signal fades in your house, which soaks up a lot
  of what the walls don't get right: [chapter 11](11-calibration.md).
