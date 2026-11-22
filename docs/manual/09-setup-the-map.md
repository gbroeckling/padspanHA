# 9. Setup: your house on a map

[Contents](README.md)

**Setup** takes your house from a list of rooms to a map, one step at a time: the floor plan, its
scale, the rooms, the floors' heights, the receivers, your phone, and calibration. This chapter goes
through each step, then the ways to a plan when you have none, and lining up two or more floors.

You don't need a map for rooms: **Who's where now** works without one ([chapter 4](04-first-room.md)).
A map adds the drawing of your house, calibration, and, with three or more receivers placed on it,
positions between receivers.

## Before you start

- **Rooms and floors come from Home Assistant.** Each room is an area, and each floor a floor, in
  **Settings → Areas, labels & zones**. Make them there first: PadSpan can't rename them. A house
  with one floor needs no floors in Home Assistant.
- **You need to be an administrator** to upload a plan or change one. Setup says so when you
  aren't.
- **Work on your own house.** While the sample house is showing, Setup's buttons can't be used:
  choose **Back to my house** first.
- **Basic or Advanced.** Setup is the same in both. In Basic, each step shows only the tool it needs.
  In Advanced, the same steps open with Mapping's other tools beside them.

## Opening Setup

- **Setup** in the menu, just above Mapping, until every step is done or you skip setup.
- **Make it a map** on the Overview's **Who's where now** card.
- **Open Setup** on the Overview's **Getting started** card.
- The **Setup** button at the top of Mapping, or **Start Setup Wizard** in an empty Mapping Library.

## The Setup page

Setup lists the steps in order, with a count ("2 of 6 done") and a bar of dots. Each step is
marked **Done**, **Next**, **To do** or **Skipped**. Done is read from your house itself, so a step
you finished somewhere else counts too.

| Button | What it does |
|---|---|
| **Start →** | Opens the step's tool. |
| **Continue →** | The same, on the step you were last working on. |
| **Open** | Opens a step that isn't next. |
| **Change** | Opens a step that is done (**Add a floor** on the floor plan step). |
| **Skip for now** | Marks the step Skipped and moves on. Open it again any time. |

The floor plan step can't be skipped: every later step uses a plan.

While you work in a step's tool, a bar at the top says which step it is ("Setup · step 3 of 6: Draw
the rooms") with **← Back to Setup**. Setup remembers where you were.

The floor plan steps (upload, scale, rooms, floor heights, receivers) run in Mapping's **Setup
Wizard**, one floor plan at a time. Its chips at the top carry Setup's numbers and names; once the
plan exists, click any chip to jump to it. **Exit setup** leaves it, keeping what you drew. The
wizard ends on **Finish**, which has the one button not to miss: **Put it on the map**.

## Step 1. Upload a floor plan

A picture of one floor. It doesn't need to be perfect: a photo of a paper plan or of your own sketch
works.

1. **Floor (from HA)**: the Home Assistant floor this plan belongs to. **Outside (Experimental)** is
   for a garden or yard; a house can have one Outside plan.
2. **Map name**: optional. Left blank, it takes the file's name.
3. **Max size**: the longest side in pixels after conversion, 1600 unless you change it.
4. Choose the picture: PNG, JPG, GIF, BMP, WebP or SVG. Drag on the preview to crop it if you like;
   **Reset Crop** starts again.
5. If the picture is your own drawing, tick **This is my own sketch, not to scale**. PadSpan then
   asks for a length each way.
6. Choose **Upload & Convert**. PadSpan keeps the plan in Home Assistant, where only people signed
   in can see it.

Upload your most exact, to-scale plan first. The others line up with it later.

A floor can have more than one plan, such as a wing drawn on its own. For the next floor, use **+
Set up another floor** at the end of the wizard, or **Add a floor** on Setup's first step.

No picture of the floor at all? See [No floor plan?](#no-floor-plan) below.

## Step 2. Set the scale

PadSpan needs the plan's real size before rooms, receivers or anything in metres can go on it.
Without a scale nothing can be put on the map, and calibration can't start.

Right after the upload, **Set this plan's scale now** opens:

1. Click (or tap) both ends of something you know the length of. The longer, the better: the longest
   wall you can, or the whole house. A doorway works, but a small slip on a short length puts the
   whole plan out more.
2. Type its length under **Its length:**. Lengths are in metres. With
   **Settings → Appearance → Units: Show lengths in feet and inches** on, they show in feet and
   inches, and you can type them that way.
3. Optional: **Add a length the other way**. A second length, running across the first, checks that
   the picture isn't stretched. If the two don't agree, the screen says so. Check both ends first;
   if the picture really is stretched (your own sketch, or a squashed scan), choose **This picture
   isn't to scale** and each direction gets its own scale.
4. Choose **Save the scale**. The wizard goes on to the rooms.

A plan you skipped shows **No scale yet** with a **Measure** button, in Setup and in Mapping's
Library. To measure a plan again later, use **Mapping → Edit → 📏 Measure** in Advanced, or Setup's
Set the scale step in Basic.

## Step 3. Draw the rooms

Trace each Home Assistant room on its floor plan.

1. Above the plan, a box counts the rooms drawn ("2 of 7 rooms drawn") and lists the ones still to
   draw. Press a room's name.
2. Click each corner of the room on the plan.
3. Double-click the last corner, or choose **Finish outline** (three corners or more).

In the Setup Wizard each room is saved as you finish it. A corner near another room's corner or edge
snaps to it; hold Alt to put it exactly where you want.

- **A room is missing from the list?** Check in **Settings → Areas, labels & zones** that its area
  is on this floor.
- **Draw every room your receivers cover.** Once rooms are on the map, a device in a room you haven't
  drawn may not show.
- **A room already drawn on another plan** is marked ⚠ with that plan's name: drawing it again makes
  a second copy.

**Let Claude draw your rooms (experimental).** Where a plan has no rooms yet, Setup and the wizard
offer **Or let Claude draw the rooms from your plan (experimental) →**. Claude reads the plan twice,
finds its rooms and their names, and draws them for you to check. Nothing is saved until you choose
**Save**, and it can be undone. It needs Home Assistant's Anthropic integration with an AI Task
running Claude, and Anthropic charges your account for each read; its first screen says what is sent
and how many reads it takes. [Connect Claude for PadSpan's room helper](https://padspan.traks.ca/guides/claude-ai-task/)
has the setup.

## Step 4. Floors and their heights

Only in a house with two indoor floors or more (Outside doesn't count). It tells PadSpan how tall
each floor is, so it can tell the floors apart. Until you set them, it uses an ordinary storey
height, 2.8 m.

The step opens the **Floor Heights** card (in Advanced, on **Mapping → 3D Stack**):

- **Floor↕ (m)**: from one finished floor to the next, ceiling and slab together. Blank means
  2.8 m.
- **Base elevation (m)**: how high the floor starts. Leave it blank unless the stacking is wrong, as
  for a split level or a mezzanine.

Choose **Save Floor Heights**. A single tall room, such as a double-height living room, keeps the
floor's normal height here: give that room its own height on the **Rooms** page (**Ceiling height**).

## Step 5. Place receivers and set their heights

Put each Bluetooth receiver where it is really mounted.

**By hand.** Beside the plan, **Live BLE Receivers** lists the receivers Home Assistant hears:

1. Choose **Add** beside a receiver. It lands in the middle of the plan, already in its Home
   Assistant room.
2. Drag it to where it is mounted.
3. Do the same for every receiver on this floor. A placed one shows **✓ placed**, with **Edit**.

Use **Add** in this list. The step's own text says you can double-click the map, and **Add Receiver**
does the same, but those make a blank "Receiver N" tied to no real receiver, and **Put it on the
map** leaves it out.

**Or let PadSpan do it.** **Put my receivers in their rooms** puts each receiver whose room has an
outline in the middle of that room, on the map of your house. It says what it placed, what it
couldn't, and why. **Undo the … placed last** takes them back. Drag each one to where it is mounted
later, in Calibration's first step, **Check receiver positions**.

**A receiver with no room.** Where a receiver has no Home Assistant area, this step lists it with a
room list and **Set room**, the room its name points to already chosen. That gives the receiver's
device the area in Home Assistant, as the Overview's **View radios list → Assign** does.

**A receiver in the wrong room.** Once you have calibration points, this step can say **Signals say
Kitchen Proxy is in Dining Room, not Kitchen: 4 of the 5 calibration points it hears best are
there.** Choose **Use Dining Room** to change its area, or **Keep Kitchen** to leave it. See
[chapter 11](11-calibration.md#signals-say-this-receiver-is-in-another-room).

**Heights.** A receiver's height counts once it is on the map of your house (after **Put it on the
map**, or **Put my receivers in their rooms**). Set it in Calibration's **Check receiver positions**
(click the marker, **Height above floor (m)**, **Save height**), on the **Receivers** page, or in
**Mapping → Edit** in Advanced. It is the same value in each place. It starts at 2.4 m. In a house
of two floors or more, the step isn't done while every receiver is at the same height: say how high
each one really is.

## Finish: Put it on the map

The wizard's last screen sums up the plan ("4 rooms drawn, 3 receivers placed") and says what comes
next.

**Until you choose Put it on the map, your rooms and receivers are only on the picture.** The
Overview, the Atlas and positioning all work from the map of your house, not from the picture.
Choose **Put it on the map**: it adds the rooms and receivers that the map doesn't have yet. Nothing
already on it changes. **Done** alone doesn't do this.

Once the first room is on the map, your house takes the place of **Who's where now** on the
Overview.

Then:

- the next-step button (**Track your phone or watch →**, **Go to Calibration →** and so on) goes
  on;
- **+ Set up another floor** starts the wizard again for the next plan;
- **Done** goes back to Mapping's Library.

**Already finished, and the Overview says "Room and receiver layout not built yet"?** You don't have
to start again. Open the Setup Wizard on that plan, go to Finish and choose **Put it on the map**.
On the **Rooms** page, a room drawn on a plan but not on the map has its own **Put it on the map**.
In Advanced, **Mapping → Layout**, with **Layout** switched to **Map placements**, has **Commit this
layout**.

## Step 6. Track your phone or watch

PadSpan learns the phone or watch you carry, so it can follow you and calibrate with it. The step is
done once PadSpan follows one phone or watch as someone's: one with its key (IRK) registered, or a
Companion-app phone you pressed Track for.

The step opens the phone wizard, **Track your phone** (in Advanced, on
**Bluetooth → IRK Manager**), with three ways in:

- **I have an Android phone**: in the Companion app, open
  **Settings → Companion app → Manage sensors → BLE Transmitter**, switch it on, set **Transmit power** to **High** and **Advertise mode** to
  **Low latency**. Then **Track it on the Overview →** opens the **Track Your Phone** card: choose
  **Track this phone** (in Basic, **Track**).
- **I have an iPhone**: the steps to get its IRK, add it to Home Assistant's Private BLE Device, and
  check it: paste it and choose **Check**, and PadSpan says how many of the rotating addresses it
  hears now are this iPhone.
- **I have an IRK Capture ESP32**: type the device's name and whose it is, pair the iPhone or Apple
  Watch with the ESP32, and save the key PadSpan finds. Then remove the pairing before the next
  device.

On an older install with both phone switches off (**Phone Setup Wizard** and **iPhone Setup Path**,
in **Settings → Features**), the step opens the Overview's **Track Your Phone** card instead.
[Which room is my phone in?](https://padspan.traks.ca/guides/phone-room-presence/) has every step,
with pictures.

## Step 7. Calibrate

Walk the house with your phone so PadSpan learns what each spot sounds like. The step is done at
five calibration points or a computed model.

- Where **Walk a room** is on (the default), **Start →** walks each room for 90 seconds, and
  **Point by point** beside it opens Guided calibration.
- Where someone turned it off, **Start →** opens Guided calibration, and a line says how to turn
  Walk a room on, with **Open that setting**.

[Chapter 11](11-calibration.md) explains both.

When every step is done, Setup says **Your house is set up.** and leaves the menu. It is still
there from Mapping's Setup button and the Overview, if you want to change a step.

## No floor plan?

On the upload step, **No floor plan? Ways to get one** lists five ways, best first. The further down
the list, the rougher the plan.

1. **Look for a drawing you already have.** The builder's or architect's drawings, the listing, the
   council file, an insurance report, the fire-escape plan on a wall. A photo held straight over the
   page is enough.
2. **Scan the floor with an iPhone or iPad.** It needs a Pro model with LiDAR (iPhone 12 Pro or a
   newer Pro, iPad Pro 2020 or newer). Any room-scanning app that uses Apple's RoomPlan can share the
   scan as a USDZ file (some also offer RoomPlan JSON). Scan the whole floor in one go, doors open and
   lights on. Choose its floor, pick the file, and PadSpan draws the plan to scale, with nothing to
   measure. You still say where each room is. **Guide me step by step** shows the same steps one
   screen at a time, made for the phone, and gives you an address to send to whoever does the scan.
3. **Use your robot vacuum's map.** A Valetudo, Dreame or Xiaomi robot that Home Assistant can see.
   Turn on **Settings → Features → Experimental Features → Robot Vacuum Import**, then use
   **Mapping → Layout → 🤖 Import from a robot vacuum**, and **Add as a new map**. It becomes a floor plan with
   its rooms; rooms you already have are kept.
4. **Draw it yourself and photograph it.** On plain paper, the outside walls first, then the walls
   between rooms, with a gap for each door. Write the length of one long wall across and one down.
   Photograph it from straight above. **I have my sketch: upload it** ticks "my own sketch" on the
   form for you, and the scale step takes a length each way.
5. **Start from a blank floor.** Type the floor's width and depth (rough is fine), choose its floor
   and **Make the blank floor**. PadSpan makes an empty floor of that size with a line every metre;
   draw each room on it by its corners, counting the lines.

Two more ways, in Advanced, on **Mapping → Layout**:

- **Rooms in metres, with no picture.** Type the area's exact name in **New room name**, choose **+
  Add room**, drag it to shape, and **Save corrections**. Calibration still needs a plan with a
  scale.
- **Sweet Home 3D.** **📐 Import floorplan (.sh3d)** reads the rooms from a Sweet Home 3D file, as a
  candidate for this floor to check and edit before you commit it. With **RoomPlan Import** on in
  Settings → Features, the same button reads a room scan.

[Which floor plan for Home Assistant?](https://padspan.traks.ca/guides/floor-plans/) and
[Your robot vacuum's map as your floor plan](https://padspan.traks.ca/guides/robot-vacuum-floor-plan/)
go further.

## More than one floor: lining them up

Each plan keeps its own place in metres. With two floors or more, line them up so a stairwell on
one sits over the stairwell on the other. This is on **Mapping → 3D Stack** (Advanced):

1. **Floor Heights**: as in step 4.
2. **Floor Assignment & Ceiling Heights**: one row per plan, with its **HA Floor** and **Stack
   Level**. **Save** on a row keeps it. Untick **Show** to hide a plan.
3. **Alignment Overlay**: choose a **Reference** (fixed, and measured) and a **Target** (the plan
   you move). Drag the Target until the stairwells and outside walls line up. **Scale +** and
   **Scale −** resize it, **−15°**, **﹢15°** and **0°** turn it, and **Opacity** helps you see both.
   Nothing is kept until you choose **Save Alignment**.
4. For a closer fit, **Point Align**: click the same real point on both plans (a stairwell corner),
   three pairs or more, then **Compute**. It rates the fit Excellent, Fair or Poor, in metres.
   **Apply** moves the Target on screen; then **Save Alignment**.

PadSpan refuses an alignment that would put more than half of a plan's calibration points off the
map. **Compare Maps**, in the Library, rates how well your floors line up once you're done.

Basic mode has no 3D Stack tab: switch the mode button to Advanced to line floors up.

## Changing it later

- **A room's outline**: the **Rooms** page, **Edit outline**; in Advanced, **Mapping → Edit**, the
  Rooms tool, or **Mapping → Layout** for the rooms in metres.
- **A receiver's place or height**: Calibration → **Tune**, or the **Receivers** page (**Place** or
  **Move**).
- **The scale**: Mapping → Edit → 📏 Measure (Advanced), or Setup's Set the scale step.
- **A plan you no longer want**: Mapping → Library, **Delete**. Its picture and what was drawn on
  it go; the rooms in metres and calibration points with a position in metres stay.
