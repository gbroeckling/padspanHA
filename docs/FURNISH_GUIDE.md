# Furnish Guide

Furnish puts furniture, devices and people into [Live Aboard](LIVE_ABOARD_GUIDE.md), the 3D house,
so it looks like your house, and a lamp, a TV or a washer in it shows what the real one is doing.
It needs PadSpan Pro and Live Aboard turned on; no add-on on sale includes it. It's in **Mapping → Furnish**
(the tab appears next to Atlas once Live Aboard is on, in Advanced mode). Like Edit, nothing is
stored until you press **Save**, and **Undo** steps back through everything.

## Adding a piece

**Build ▾** adds a piece of furniture or a device: a sofa, a bed, a table, a lamp, a TV, stairs
and more, or a plain **Box**. Each kind has its own sliders (a sofa's seats and arms, a bed's size,
a table's shape). The builders are simple shapes in the Sims' spirit, not scans.

The other ways in:

- **From a photo:** photograph a real piece and PadSpan builds a matching one. This needs Home
  Assistant 2025.8 or newer with an **AI Task** that can read images, picked in **Settings → AI**,
  where **Furniture from a photo** can also be switched off. A cloud AI Task means the photo leaves
  your house to be read; it's never stored. It names the piece in its own words, then reads that
  kind's details; telling it what the piece is first saves that step. It asks you for one real
  measurement unless something of known size (a door, a tape measure) is in the photo. If the
  answer makes no sense, you get a box, never an error.
- **Library:** furniture other PadSpan houses shared. Turn on **Shared library** in the Live Aboard
  settings and accept its terms first. Off, Live Aboard never contacts the library.
- **Import:** doors, windows and furniture from a Sweet Home 3D file (`.sh3d`), or, with RoomPlan
  import on (Settings → Features), from a phone's room scan (`.usdz` or `.json`): its doors, windows
  and openings (an archway as a doorway) with their heights, and its furniture. Each door or window
  goes on the nearest wall of the house; one with no wall near it is left out and counted. You see
  them first and pick what to keep; nothing is written until you commit.
- **People & devices:** see below.

## Kitchens and bathrooms

Build ▾ has a **Kitchen** and a **Bathroom** heading:

- **Kitchen:** base cabinets (doors, drawers, or a drawer over doors), wall cabinets (doors, glass,
  lift-up or open), tall cabinets (doors, an oven, or an oven and a microwave), a sink with one or
  two bowls, a hob or a freestanding cooker (induction or gas), a dishwasher and a fridge (tall,
  double or under the counter). Each base unit has its own worktop, so a row of them side by side
  reads as one.
- **Bathroom:** a toilet (on the floor or hung on the wall), a basin (on a vanity, a pedestal or the
  wall; one or two), a bath (built-in or freestanding) and a shower (a glass enclosure or a walk-in
  screen).
- A sink's or a basin's **Height** goes up to the top of its tap: a 1.2 m sink has its worktop at
  0.9 m, level with the cabinets beside it. Under a window only the worktop counts, so a sink fits
  under a sill as high as its worktop, its tap in front of the glass.
- To put up a wall cabinet, set its **Height in room** to 1.45 m (the usual height over a 0.9 m
  worktop) and drag it to the wall, or use **Hang on wall**.
- **Library** has ready-made kitchen and bathroom pieces too, with the shared library on or off.

## Room sets

**Build ▾ → Room sets** furnishes a whole room in one tap: **Kitchen, one wall**, **Kitchen,
L-shaped**, **Bathroom**, **Bedroom**, **Living room**, **Dining room** or **Office**.

- Turn the view so the room is in the middle, then pick a set.
- Pieces go along the walls with their backs to them. They step past doors, windows and anything
  already in the room, and always stay inside it. PadSpan tries each wall in turn and keeps the
  one that fits the most.
- In a kitchen, the wall cabinets hang over the base units, and when the base units pass under a
  window, the sink goes under it.
- A piece with no room is left out, and the message says how many.
- It's a first go to adjust: drag, turn, change or delete any piece. In an odd-shaped room expect
  fewer pieces, and an L-shaped kitchen can leave a small gap in its corner. One **Undo** takes the
  whole set away, and nothing is kept until **Save**.

## Floors and walls

Tap a room's floor (with no piece picked) and its panel opens (for the kitchen, **Kitchen: floor and
walls**). Tap another room to switch to it; tap outside the house to close it.

- **Floor**: **As drawn** (the room's colour), or a material: **Wood**, **Light wood**, **Tile**,
  **Stone**, **Carpet** or **Concrete**. Each is drawn with its own colour and its planks or joints,
  laid square to the room's longest wall.
- **Walls**: the colour of the room's walls on the inside. The other side of a wall it shares keeps
  the next room's colour.
- **One wall a colour of its own**: lists the room's walls by number and length; pointing at a row
  outlines that wall. Give one an accent colour.
- **Outside walls**: the colour of the outside walls of the whole floor.
- **As drawn** next to any colour takes it back to how it was.

Each change is one **Undo**, and nothing is kept until **Save**. The floors and walls are in Live
Aboard's own file, so a PadSpan backup carries them and a restore brings them back.

They show in Live Aboard's own looks, **Classic** and **Studio** (**Views ▾ → Look**). A Showcase
theme, and the Atlas's look, keep their own colours, so there the house looks as it did. Until you
pick something, nothing changes anywhere.

## Moving and setting a piece

- **Drag** a piece across the floor. Its back snaps to the walls, and two short lines show how far
  it is from the nearest walls.
- **Arrow keys** nudge the picked piece 1 cm (Shift: 10 cm) the way you're looking; **[** and **]**
  turn it 15° (Shift: 1°).
- The piece's panel has its label, size, its builder's settings, colours, **Turn**, **Floor ▲ / ▼**
  (the view follows it), **Height in room**, exact **X, Y, Height and Angle**, **Duplicate** and
  **Delete**. **Stand on what's under it** puts a lamp on its table; **Hang on wall** at a height
  you pick.
- Warnings tell you when a piece doesn't fit (through a wall, off the floor).
- **Stairs** (Build ▾ → House → Stairs): which way they turn and the floor they go up to. Their
  height is always the gap up to that floor, and they open a hole in it.
  - **Shape:** Straight, L, U, **2 landings** (up one side, across the back, down the other side to
    the front) or **3 landings** (round an open well; the last flight passes over the start of the
    first, high enough to walk under, and you step off at the side you started from).
  - **Style:** **Closed** (solid steps), **Open** (the treads alone, on a board each side, with
    gaps between them), **Treads only** (nothing under them, as if fixed into the wall beside
    them) or **Floating** (the treads alone on one steel spine down the middle, fixed to the
    floor at the bottom and to the floor or landing at the top, touching no wall).
  - **Rail:** **None** until you pick **Both**, **Inside** (the well side of a turn; Left on a
    straight flight) or **Outside** (Right on a straight flight). Stairs from before 2026-11-02 were
    given the rail they showed as their setting (the plain rods closed straight, L and U stairs
    always had, as a Single bar; a balustrade on the open side for the other styles and shapes,
    both sides of a Floating stair). A rail stands its full height, so over the top flights it
    rises into the opening in the floor above, as a real one does.
  - **Rail style:** **Balustrade** (a handrail on spindles, a post at each end), **Topless** (the
    spindles and posts with no top rail) or **Single bar** (one bar and nothing under it, on a post
    at each end).
  - **Stairs in stair rooms** (Build ▾ → House, shown when there are some): a first guess for each
    room called Stairs, Stairwell or Staircase (Escalier, Treppenhaus, Trap…) that has none yet and
    a floor above. It's squared to the room's longest wall and sized to the room: a straight flight
    against a long wall when the room is long enough, else a U or a flight round two landings
    filling it, with no rail until you pick one. Drag it, turn it or change it like any other; nothing is
    kept until Save.
  - **Read stairs off the plans (AI)** (Build ▾ → House, with **Settings → AI → AI map-building research
    (experimental)** on, **Stairs from your floor plans** on under it, and an AI Task picked; with the
    master switch off, both the row and this item are hidden): your AI looks for the stairs on each floor plan you placed and adds
    what it finds, unsaved: put on the floor it climbs from (a flight marked DOWN on an upper plan goes on
    the floor below), one staircase seen on two plans added once, none where stairs already stand, each
    squared to its room. It's a first guess: in a test with a small local model (qwen2.5vl:7b) it found
    most staircases but got their exact size and which way is up wrong often enough that you should check
    every one. A bigger or cloud model reads plans better. A plan is sent to your AI only when you press it.
  - **Check the AI's finds one by one (experimental):** **Edit → Plans** in Live Aboard shows your plan
    under the house with what the AI found, and you accept or refuse each item before anything is kept. It's
    an experiment and the AI gets things wrong, so check every item. See
    [Plans](LIVE_ABOARD_GUIDE.md#plans-what-an-ai-finds-on-your-floor-plans-experimental) in the Live Aboard
    Guide. On a device with no 3D, this tab offers the same items as a list: **Add data via plans (experimental)**.
  - **From a file:** Import brings a Sweet Home 3D staircase in as stairs (its own staircase mark, or
    a name like "Spiral staircase" or "L-shaped stairs" for a first guess at the shape; a mirrored
    model turns the other way), and with RoomPlan import on (Settings → Features), the furniture and
    stairs of a RoomPlan scan (.json) too. Stairs from a file are squared to their room's walls when
    they're within about 12° of them.

## A piece that's a real device

**This is a device…** links a piece to a Home Assistant entity, and it then behaves like it: a lamp
glows in its light's colour, a TV lights up while it's playing, a fan's blades turn, a washer or
dryer shakes while it runs, a robot vacuum or mower leaves its dock while it's working, a radiator
glows while heating, a car or charger shows when it's charging. If the entity is renamed, the piece
follows it; if it's deleted, the piece shows an **Unlinked** badge and stays put.

## People

**People & devices** shows each Home Assistant person in the house:

- **A figure** made by hand with sliders (height, build, hair, colours), or **from a photo**. A
  figure is a few simple shapes, never a likeness. The photo path asks first that the person
  agrees, and nothing is sent until that's ticked. It recommends a local AI Task.
- **Carries:** pick which phones and tags each person carries, from what PadSpan tracks. Those are
  what place that person in Live Aboard and on the Atlas. This stays in your house only.
- People are never shared: figures live only in this house's 3D file. Deleting a person in Home
  Assistant takes their figure with it.

Show or hide people (and tags and scanners) with **Show people** and **Show tags & scanners** in
Settings or in Live Aboard's **Views ▾**.

## Sharing a piece

A piece you built can be shared to the library with **Share…**. Only its shape, sizes, colours and
the details you fill in are shared, never a photo or anything about your house. A title with an
email, phone number, address or link is refused. You can withdraw a share later.

## Clearing it out

**Settings → Atlas → 🏠 Live Aboard** has **Remove all furniture…** (administrators). A
backup is taken first; to bring the furniture back, restore that backup from Backup & Restore.
