# Furnish Guide

Furnish puts furniture, devices and people into [Live Aboard](LIVE_ABOARD_GUIDE.md), the 3D house.
It needs PadSpan Pro and Live Aboard turned on, and it's in **Mapping → Furnish** (the tab appears
next to Atlas once Live Aboard is on, in Advanced mode). Like Edit, nothing is stored until you press **Save**, and
**Undo** steps back through everything.

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
- **Import:** doors, windows and furniture from a Sweet Home 3D file (`.sh3d`). You see them first
  and pick what to keep; nothing is written until you commit.
- **People & devices:** see below.

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
    gaps between them) or **Treads only** (nothing under them, as if fixed into the wall beside
    them).
  - **Rail:** **Auto**, **Both**, **Inside** (the well side of a turn; Left on a straight flight),
    **Outside** (Right on a straight flight) or **None**. Auto keeps the plain rods closed
    straight, L and U stairs have always had, and gives the other styles and shapes a handrail on
    spindles on the open side. A rail stands its full height, so over the top flights it rises
    into the opening in the floor above, as a real one does.
  - **Stairs in stair rooms** (Build ▾ → House, shown when there are some): a first guess for each
    room called Stairs, Stairwell or Staircase (Escalier, Treppenhaus, Trap…) that has none yet and
    a floor above. It's squared to the room's longest wall and sized to the room: a straight flight
    against a long wall with the rail on the open side when the room is long enough, else a U or a
    flight round two landings filling it. Drag it, turn it or change it like any other; nothing is
    kept until Save.
  - **Read stairs off the plans (AI)** (Build ▾ → House, with **Settings → AI → Stairs from your floor
    plans** on and an AI Task picked): your AI looks for the stairs on each floor plan you placed and adds
    what it finds, unsaved: put on the floor it climbs from (a flight marked DOWN on an upper plan goes on
    the floor below), one staircase seen on two plans added once, none where stairs already stand, each
    squared to its room. It's a first guess: in a test with a small local model (qwen2.5vl:7b) it found
    most staircases but got their exact size and which way is up wrong often enough that you should check
    every one. A bigger or cloud model reads plans better. A plan is sent to your AI only when you press it.
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

**Settings → UI Structure → 🏠 Live Aboard** has **Remove all furniture…** (administrators). A
backup is taken first; to bring the furniture back, restore that backup from Backup & Restore.
