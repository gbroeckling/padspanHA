# 17. Furnish

[Contents](README.md)

Furnish puts furniture, devices and people into Live Aboard, the 3D house
([chapter 16](16-live-aboard.md)). It needs PadSpan Pro and Live Aboard turned on, and it is in
**Mapping → Furnish**: the tab appears next to the Atlas builder once Live Aboard is on, in Advanced
mode. As in Edit, nothing is stored until you press **Save**, and **Undo** steps back through
everything.

## Adding a piece

**Build ▾** adds a piece of furniture or a device: a sofa, a bed, a table, a lamp, a TV, stairs and
more, or a plain **Box**. Each kind has its own sliders (a sofa's seats and arms, a bed's size, a
table's shape). They are simple shapes in the Sims' spirit, not scans.

The other ways in:

- **From a photo**: photograph a real piece and PadSpan builds a matching one. It needs Home
  Assistant 2025.8 or newer with an **AI Task** that can read images, picked in **Settings → AI**,
  where **Furniture from a photo** can also be switched off ([chapter 19](19-ai-features.md)). With a
  cloud AI Task, the photo leaves your house to be read; it is never stored. It asks for one real
  measurement unless something of known size (a door, a tape measure) is in the photo. If the answer
  makes no sense, you get a box, never an error.
- **Library**: furniture other PadSpan houses shared. Turn on **Shared library** in the Live Aboard
  settings and accept its terms first. Off, Live Aboard never contacts the library.
- **Import**: doors, windows and furniture from a Sweet Home 3D file (`.sh3d`), or, with RoomPlan
  import on (**Settings → Features**), from a phone's room scan (`.usdz` or `.json`). Each door or
  window goes on the nearest wall; one with no wall near it is left out and counted. You see them
  first and pick what to keep.
- **People & devices**: below.

## Kitchens and bathrooms

**Build ▾** has a **Kitchen** and a **Bathroom** heading:

- **Kitchen**: base cabinets (doors, drawers, or a drawer over doors), wall cabinets, tall cabinets
  (with an oven, or an oven and a microwave), a sink with one or two bowls, a hob or a cooker, a
  dishwasher and a fridge. Each base unit has its own worktop, so a row of them reads as one.
- **Bathroom**: a toilet, a basin (on a vanity, a pedestal or the wall), a bath and a shower.
- A sink's or basin's **Height** goes up to the top of its tap: a 1.2 m sink has its worktop at
  0.9 m, level with the cabinets beside it, and fits under a sill as high as its worktop.
- To put up a wall cabinet, set its **Height in room** to 1.45 m (the usual height over a 0.9 m
  worktop) and drag it to the wall, or use **Hang on wall**.

## Room sets

**Build ▾ → Room sets** furnishes a whole room in one tap: **Kitchen, one wall**,
**Kitchen, L-shaped**, **Bathroom**, **Bedroom**, **Living room**, **Dining room** or **Office**.

- Turn the view so the room is in the middle, then pick a set.
- Pieces go along the walls, backs to them, stepping past doors, windows and anything already there,
  and always inside the room. PadSpan tries each wall and keeps the one that fits the most.
- In a kitchen, the wall cabinets hang over the base units, and the sink goes under a window.
- A piece with no room is left out, and the message says how many.
- It is a first go to adjust. One **Undo** takes the whole set away.

## Moving and setting a piece

- **Drag** a piece across the floor. Its back snaps to the walls, and two short lines show how far it
  is from the nearest walls.
- **Arrow keys** nudge it 1 cm (Shift: 10 cm); **[** and **]** turn it 15° (Shift: 1°).
- Its panel has its label, size, its builder's settings, colours, **Turn**, **Floor ▲ / ▼**,
  **Height in room**, exact **X, Y, Height and Angle**, **Duplicate** and **Delete**.
  **Stand on what's under it** puts a lamp on its table; **Hang on wall** at a height you pick.
- Warnings tell you when a piece doesn't fit (through a wall, off the floor).

## Stairs

**Build ▾ → House → Stairs**: which way they turn and the floor they go up to. Their height is the
gap up to that floor, and they open a hole in it.

- **Shape**: Straight, L, U, **2 landings** or **3 landings** (round an open well).
- **Style**: **Closed** (solid steps), **Open** (treads on a board each side), **Treads only** (as if
  fixed into the wall) or **Floating** (treads on one steel spine).
- **Rail**: **None** until you pick **Both**, **Inside** or **Outside**. **Rail style**:
  **Balustrade**, **Topless** or **Single bar**.
- **Stairs in stair rooms** (shown when there are some): a first guess for each room called Stairs,
  Stairwell or Staircase that has none yet and a floor above, sized to the room.
- **Read stairs off the plans (AI)** (with **AI map-building research (experimental)** and
  **Stairs from your floor plans** on in **Settings → AI**, and an AI Task picked): your AI looks for
  stairs on each floor plan and adds what it finds, unsaved. It is a first guess: check every one.
  A plan is sent to your AI only when you press it.
- **From a file**: Import brings a Sweet Home 3D staircase in as stairs, and a RoomPlan scan's stairs
  too.

## A piece that's a real device

**This is a device…** links a piece to a Home Assistant entity, and it behaves like it: a lamp glows
in its light's colour, a TV lights up while playing, a fan's blades turn, a washer shakes while it
runs, a robot vacuum leaves its dock while working, a radiator glows while heating. If the entity is
renamed, the piece follows it; if it is deleted, the piece shows **Unlinked** and stays put.

## People

**People & devices** shows each Home Assistant person in the house:

- **A figure** made with sliders (height, build, hair, colours), or **from a photo**. A figure is a
  few simple shapes, never a likeness. The photo path asks first that the person agrees, and sends
  nothing until that is ticked. It recommends a local AI Task.
- **Carries**: which phones and tags each person carries, from what PadSpan tracks. Those place the
  person in Live Aboard and on the Atlas.
- People are never shared: figures live only in this house's 3D file. Deleting a person in Home
  Assistant takes their figure with it.

**Show people** and **Show tags & scanners**, in Settings or in Live Aboard's **Views ▾**, show or
hide them.

## Sharing a piece

**Share…** shares a piece you built to the library: only its shape, sizes, colours and the details you
fill in, never a photo or anything about your house. A title with an email, phone number, address
or link is refused. You can withdraw a share later.

## Clearing it out

**Settings → Atlas → Live Aboard** has **Remove all furniture…** (administrators). A backup is taken
first; to bring the furniture back, restore that backup ([chapter 22](22-backup-restore-moving.md)).
