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

A picture of one floor, or a PDF of it. It doesn't need to be perfect: a photo of a paper plan or of
your own sketch works.

1. **Floor (from HA)**: the Home Assistant floor this plan belongs to. **Outside (Experimental)** is
   for a garden or yard; a house can have one Outside plan.
2. **Map name**: optional. Left blank, it takes the file's name.
3. **Max size**: the longest side in pixels after conversion, 1600 unless you change it.
4. Choose the picture: PNG, JPG, GIF, BMP, WebP or SVG, or a PDF such as an architect's drawing. A
   PDF with several pages asks which page is the plan; that page is drawn as a picture in your
   browser and goes on like any other. A password-protected PDF can't be read: save it without a
   password, or as a picture, first. Drag on the preview to crop it if you like; **Reset Crop**
   starts again.
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

## Start with a rough house

No plan and no drawing? Setup, and Mapping while it has no floor plans, offer **Start with a rough
house from your Home Assistant rooms** for as long as no room is drawn. It only runs when you press
it.

1. Choose **Show what it will make**. It lists each floor with its rooms, and anything it leaves
   out, with why: a room already drawn, a floor that already has a plan or rooms, an area outdoors.
2. An area that has no floor in Home Assistant goes on the floor you pick there (the first floor, if
   you don't).
3. Choose **Make the rough house**.

For each floor with no plan yet, PadSpan makes a blank floor marked "rough start", with one square
box for each Home Assistant area on it, named as the area. A box is 3.5 m across, a little bigger
where the area has more than four devices, at most 6 m. Your devices show in their rooms at once, as
they do for any room. Nothing else changes: no calibration point, receiver or wall is touched, and a
second press makes nothing.

The boxes are placeholders for drawing the rooms: until you reshape or replace them, Setup's **Draw the
rooms** step stays to do, a real plan of that floor opens on its Rooms tool, and **Let Claude draw your
rooms** is still offered for it. For everything else (where people and devices are) they are rooms.

The boxes are a starting point. The rough plan's note says how many are still boxes, with two ways
on:

- **Reshape the rooms.** In Advanced, this opens **Mapping → Layout** on that floor: drag and resize
  each box, then **Save corrections**. In Basic it opens the Setup Wizard's rooms step on the rough
  plan, where the boxes are drawn dashed: draw the room over its box.
- **Upload a plan of this floor.** Upload, scale and trace the rooms as in steps 1 to 3. The rough
  plan never gets in the way.

Either way, **Put it on the map** (the wizard's Finish, or the room's own button on the **Rooms**
page) puts each room you traced in place of its box. The room keeps its name, so it stays linked to
its Home Assistant area. A box you have reshaped in Layout is yours: nothing replaces it. Once a
floor has its real plan, you can delete the rough plan in the Library. Its rooms stay on the map, and so
do the calibration points taken on it.

## No floor plan?

On the upload step, **No floor plan? Ways to get one** lists six ways, best first. The further down
the list, the rougher the plan.

1. **Look for a drawing you already have.** The builder's or architect's drawings, the listing, the
   council file, an insurance report, the fire-escape plan on a wall. A PDF goes up as it is; for
   paper, a photo held straight over the page is enough.
2. **Import a plan from another app.** A house already drawn elsewhere comes in drawn to scale:
   - **Easy Floorplan** (the Home Assistant card): edit the card, open its code editor, copy all of it
     into a text file ending in `.yaml`. Its walls, doors, windows and rooms come in; a room linked to a
     Home Assistant area is named after it. The card has no unit, so type the drawing's width (outside
     wall to outside wall) in the field above the file; left empty, the scale is taken from its doors
     (each taken as 85 cm), and you measure one length to make it exact.
   - **DXF** from a CAD program, saved as text (not binary, not DWG). Each closed polyline becomes a
     room, named by the text inside it; lines and open polylines are walls. The unit comes from the
     drawing's own setting (`$INSUNITS`); a drawing without one needs its width typed.
   - **Floorplanner**: export the project (Quick Export, where your project offers it) and pick the
     `.fml` file from the zip, or the zip itself. Its walls, doors, windows and rooms come in.

   Choose the floor and pick the file (2.8 MB at most). A file with several floors asks which one this
   is; an Easy Floorplan floor linked to the Home Assistant floor you chose is picked by itself. What
   PadSpan doesn't use (devices and their entities, furniture, texts, curves drawn straight) is listed,
   in the message and beside the rooms on the plan. The file's rooms are outlines, not new rooms: choose
   each Home Assistant room in the list and press **Use the outline the file gives** it (or **Use a
   scanned outline instead** and click inside one), so your rooms stay your Home Assistant areas.
3. **Scan the floor with an iPhone or iPad.** It needs a Pro model with LiDAR (iPhone 12 Pro or a
   newer Pro, iPad Pro 2020 or newer). Any room-scanning app that uses Apple's RoomPlan can share the
   scan as a USDZ file (some also offer RoomPlan JSON). Scan the whole floor in one go, doors open and
   lights on. Choose its floor, pick the file, and PadSpan draws the plan to scale, with nothing to
   measure. You still say where each room is. **Guide me step by step** shows the same steps one
   screen at a time, made for the phone, and gives you an address to send to whoever does the scan.
4. **Use your robot vacuum's map.** A Valetudo, Dreame or Xiaomi robot that Home Assistant can see.
   Turn on **Settings → Features → Experimental Features → Robot Vacuum Import**, then use
   **Mapping → Layout → 🤖 Import from a robot vacuum**, and **Add as a new map**. It becomes a floor plan with
   its rooms; rooms you already have are kept.
5. **Draw it yourself and photograph it.** On plain paper, the outside walls first, then the walls
   between rooms, with a gap for each door. Write the length of one long wall across and one down.
   Photograph it from straight above. **I have my sketch: upload it** ticks "my own sketch" on the
   form for you, and the scale step takes a length each way.
6. **Start from a blank floor.** Type the floor's width and depth (rough is fine), choose its floor
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

### Room location runs with the robot

A robot that runs Valetudo, with its map imported that way, can also help PadSpan learn your rooms.
It is optional, and nothing happens until you start a run. Stick a fixed-address Bluetooth beacon
(iBeacon or Eddystone) on top of the robot, away from its laser turret. Not an AirTag or a Tile:
their addresses keep changing. PadSpan never hears the robot itself, only the beacon on it.

The robot shows on the Atlas and in the 3D house while its live position is on and Robot Vacuum
Import is turned on, whether people and tags are shown there or not. Press and hold it to open its
card. The card talks to the robot's own Valetudo,
so Home Assistant's vacuum entity and MQTT are not needed. It shows what the robot is doing and its
battery, with **Start**, **Pause** and **Dock**. Only an administrator can use it.

Under **Room location** the card lists what a run needs: the robot's address (and its Valetudo user
and password, if its login is on), its map from Valetudo, and the beacon on the robot, with whether
PadSpan hears it now. **Start a run** sends the robot to spots about 1.5 m apart in every room, or
in the one you pick, each at least 40 cm from the walls, and never in a no-go area or by a virtual
wall or an obstacle on the robot's map. At each spot it stands still for about 20 seconds while
PadSpan listens to the beacon, every packet each receiver hears (a little longer if too few
receivers heard it, and the spot is skipped if still too few did). If the robot moved during the
stop, the spot is dropped; one it cannot reach is skipped. Calibration is backed up before every
run, and a run does not start if the robot's map has changed since it was imported (its dock
moved): import it again then. If a Valetudo timer is due to start the robot within two hours, the
card says so.

Before the first run you choose how the robot's points are used; nothing is picked for you, and you
can change it any time:

- **Count them like your own**: every spot goes into calibration, at full weight.
- **Fill gaps, count them less**: only in rooms where you have fewer than 3 points of your own,
  and at half weight.
- **Find mistakes and Wi-Fi only**: nothing goes into calibration.

Every spot's readings are kept with its run either way. When you change the choice, the card says
what it would change for earlier runs and lets you apply it (in one step, after a backup, and
undoable) or leave them as they are. After each run the card shows how your own test spots scored
before and after it. **Stop** ends the run and sends the robot back to its dock; so does the
end of the run, a problem, or two hours. If the robot heads back to its dock on its own, someone
or a Valetudo timer takes it over (cleaning, driving it, pausing it), or its battery drops below
20 %, the run ends there and PadSpan sends it nothing more; below 20 % a run does not start. **Undo this run** takes out exactly the points that run added, and none of your
own; every earlier run whose points are still there is listed on the card with its own **Undo**. A
run that was going when Home Assistant restarted, or when PadSpan was reloaded or a backup restored,
is over (the robot is sent home); its points stay, and can still be undone.

The robot's points count as PadSpan's own, like a pinned beacon's automatic points, not as yours.
Only a run's Undo removes them: the beacons' own clean-ups never touch them.

**Find mistakes** on the card opens a card of its own. From the points the runs already stored (no
extra driving), it works out where each receiver really is, and lists the ones that look placed in
the wrong spot, or on the wrong floor (one placed upstairs that hears the robot downstairs about as
strongly as the receivers there do), with how sure it is and a link to that receiver's placement.
A receiver needs to be heard at six spots or more, spread over 3 m and lying round it, so a run of
one room says nothing about a receiver in the next; the others are listed as not enough readings.
It never moves anything.

On a wall screen the card shows only what the robot is doing and its battery.

At each spot the robot also reports its own Wi-Fi signal. PadSpan keeps the last 2,000 of these for
the Wi-Fi coverage map, and other integrations can read them.

The robot can also report its Wi-Fi while it cleans on its own. Turn on **Collect Wi-Fi while it
cleans** on its card (it is off until you do). While the robot is cleaning or driving, and its live
position is on, PadSpan reads its Wi-Fi and where it is about every 5 seconds, and nothing while it
is docked or during a run. These readings are taken on the move, so each counts a tenth of a
standing-still one; PadSpan keeps the last 5,000, apart from the run spots. On the Wi-Fi coverage
screen they are faint squares under the diamonds, with **While it cleaned** to hide them.

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
