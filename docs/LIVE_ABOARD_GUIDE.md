# Live Aboard Guide

Live Aboard is the Atlas in 3D: your floors, rooms, walls, doors, windows, lights and sensors as a
little house you can turn, zoom and tap, the way you'd look into a house in The Sims. It's built
from the map you already drew, so there's nothing new to set up before you see it.

It's **experimental** and still changing. If something looks wrong in your house, please say so.

- [Turning it on](#turning-it-on)
- [Getting around](#getting-around)
- [Reading the house](#reading-the-house)
- [Using it](#using-it)
- [Building: doors, windows, heights and strips](#building-doors-windows-heights-and-strips)
- [On a wall screen](#on-a-wall-screen)
- [When something's off](#when-somethings-off)

---

## Turning it on

Live Aboard comes with PadSpan Pro (and Bright Pro).

1. Go to **Settings → UI Structure**, find **💡 Atlas — Mapped Light Control**.
2. Under **🏠 Live Aboard**, turn on **Show Live Aboard on the Atlas**. It saves right away, no
   restart.
3. Open the Atlas. In the sidebar, tap **🏠** on the left rail to switch between the flat map and
   Live Aboard. In Mapping → Atlas, use the **Map | Live Aboard** switch beside the zoom.

The same card has a few more choices:

- **Rain and snow:** falls outside the house when your weather says so (the same weather the
  Atlas uses).
- **Look:** the same colours as the Atlas, or Live Aboard's own.
- **Back to home view:** on the sidebar, how long it waits untouched before it flies back to its
  home view (Off, 30 s, 1 min, 5 min).
- **Show people** and **Show tags & scanners:** on the map and in Live Aboard.

**Set it up step by step:** the **✨ Set it up step by step** button on that card (or **🏠 Set up
Live Aboard** at the top of Mapping → Atlas) opens a wizard that builds the whole house with you:
turn it on, floor heights, rooms, devices, heights, doors and windows, LED strips, furniture, the
optional extras (look, quality, rain and snow, people, tags and scanners, the shared furniture
library, furniture from a photo, back to home view) and making it your screen, including the
**Show the Atlas as Overview** switch. Each step says what it found in your house and what's left.

If 🏠 is greyed out, the reason shows beside it (an old browser without WebGL, for example). Tap
it to try again.

---

## Getting around

| To... | Do this |
|---|---|
| Turn the house | Drag with one finger or the left mouse button |
| Move it | Two fingers, or the right mouse button |
| Zoom | Pinch, or the mouse wheel |
| Go to a room | Double-tap the room |
| Look straight down | **Top** |
| Back to the usual angle | **Iso** |
| Turn a quarter | **⟳ 90°** |
| See all of it again | **Fit**, or **Views ▾ → Whole house** |
| North up | Tap the compass |

**Walls** (bottom left):

- **Cut** lowers the walls in front of you so you can see in, like the Sims' cutaway.
- **Up** stands every wall at full height. Best for looking at the house from outside, and at night.
- **Down** lays all walls low.
- **Roof** shows the roof when you look from outside, or never.

**Floors** (the stepper next to Walls, in a house with more than one floor):

- **▲ / ▼** step to the floor above or below; floors above the one you pick are hidden, so you can
  see into it. Tap the floor's name for its sheet.
- **All** shows every floor.
- **⇕ Explode** (with All): pulls the floors apart so you can see into each one at once. Tap it
  again to stack them back. Your browser remembers it.
- On a keyboard: **PgUp / PgDn** change floor, **Home** shows them all.

**Views ▾** has every floor, **Whole house**, and views you save: get the camera where you like it
and pick **Save this view**. **Set as home** makes the current view the one the sidebar opens on
and goes back to.

---

## Reading the house

**Lights** glow in their own colour and brightness and light up the floor around them. A light
that's off is a small dark fixture.

**Rooms** carry their name, and their temperature, humidity or air quality underneath when a sensor
in the room reports it. A reading that hasn't come in for over an hour shows a dash ("–°") instead
of a number, so you never read an old one as current.

**Motion:**

- A sensor tripping **right now** is a bright blue badge, and its room's floor is tinted blue.
- One that tripped **earlier** is a smaller badge ringed in its age colour: from blue (just now)
  through green, yellow and orange to red (about 2 hours). Its room keeps a fainter tint.
- Each badge has a **dashed line down to a ring on the floor**: that's where the sensor really is,
  even when it's up on the ceiling.
- From the whole house you see the last 40 minutes. Pick **Motion** in the device types (☰) to
  see every motion sensor.
- The **Motion chip** at the top names the newest rooms ("Kitchen now · Hall 12 min"). Tap a room
  to go there; **ⓘ** shows the colour key.

**Hover** over a light, fan or sensor that's up off the floor and a dashed amber line drops to its
spot on the floor.

**Heat map:** open ☰ and pick **Temps**. Each room with a thermometer turns its temperature colour:
blue when it's cool, green around 21°, red from 26°. °F sensors work too.

**Window open in the rain:** when it's raining or snowing, an open window glows blue and a line
under the Motion chip says which one ("☔ Window open in the rain · Bedroom window"). Tap it to go
there. It needs a window drawn on the map with its sensor linked, and weather set up for the Atlas.

**At night** the house darkens with the real sun. With the walls up, the windows of lit rooms glow
warm from outside.

**Emergency:** a leak sensor, smoke alarm, gas alarm or CO alarm that goes off sends alarm rings across its room's floor and shows a red word over everything (**WET**, **SMOKE**, **GAS**, **CO**, or **ALARM** while it's still latched), so you see it from anywhere in the house. The banner across the top of every PadSpan page lists it until you reset it.

**Mezzanines and open edges:** draw a mezzanine, gallery or loft as its own floor in Home Assistant.
In Mapping → Floor Heights, give the hall underneath its full height (floor to roof) and the
mezzanine its real **base elevation**. Live Aboard then draws the mezzanine inside the hall, under
the hall's roof. Where its edge has a railing in real life, draw that edge in Mapping as a wall
with the **Open (Loft)** material: over the hall it gets a glass railing. Anywhere else (between
two rooms on one floor, or over an ordinary storey below) it stays an open gap.

**Doors and windows** linked to sensors open and shut as they do. A lock linked to a door glows red
while it's unlocked.

**Codes** (A01, M03…) show under devices once you're zoomed in close to a room. When two would
overlap, the farther one steps aside; its device still shows and still takes taps.

---

## Using it

- **Tap a light** to switch it on or off.
- **Hold a light** (or long-press) for its controls: brightness, colour, effects.
- **Tap a sensor or a readout** for its card; a motion sensor's opens its activity calendar.
- **Tap a room's name** for the room's sheet: every device in it, **All lights on / off**, fans, and
  **▶ buttons for the room's own scenes and scripts** (whatever Home Assistant has in that area).
- **Tap a floor's name** (in the stepper) for the floor's sheet.

---

## Building: doors, windows, heights and strips

Building happens in **Mapping → Atlas**, in Live Aboard, with **Edit**. Nothing is stored until you
press **Save**.

### Doors, windows and doorways

1. Press **Edit**, then **Door**, **Window** or **Doorway**. The view turns to look straight down
   so you're tracing the plan (it works from any angle too).
2. **Press on a wall and drag along it**, or **tap its two ends**. The length shows as you go and
   steps in 5 cm. The line stops at a corner or at another door or window, and says so.
3. Let go: the opening is there and its sheet opens on the right.

On the sheet:

- **Is a:** Door, Window or Doorway.
- **Door:** Height; **Type** (Hinged, Double / French, Sliding, Barn, Pocket, Bifold, Overhead
  garage, Roll-up, Tilt-up or Gate, or PadSpan's guess); for a hinged door, **Hinge** and **Swing**;
  for a sliding one, which way it **Slides** and whether it's **Glass**; **Follows:** a door or
  garage sensor, or a cover, so it opens and shuts as that does; **Shown** (Open, Ajar or Shut)
  for a door with nothing to follow.
- **Window:** **Sill** and **Head** heights.
- **Delete** removes it.

To change one later, tap it while Edit is on. Drag either end to make it wider or narrower.

A door or window you drew on the flat map (with its sensor) can be tapped too, to set its hinge and
swing or its sill and head. Those live on the map, so you move or delete them there.

### Heights

**Heights** puts every device at the height it really is, for the 3D view.

1. Press **Edit → Heights** and tap a light, a sensor or a readout.
2. Use the slider, or tap one of the spots offered for that kind of device (**Ceiling**, **Corner**,
   **High on the wall**, **Wall**, **Switch height**, **Table**, **Floor**…). A dashed line from the
   device to the floor shows its height as you set it.
3. **Reset to default** puts it back to what PadSpan uses for its kind. For a light you can also
   say what it is (**What is this?**: a pot light, a pendant, a lamp…).

You can set heights on the flat map too: in Mapping → Atlas, pick a device and use its **Height**
row, or the **Heights** list to set several at once. They're the same heights.

### Strip (LED strips, valances, coves, string lights)

1. Press **Edit → Strip** and tap the light, or pick it from **Lights to lay out**.
2. Lay it out:
   - **Round this room** runs it round the walls of the room it's in, in one tap. Tap another room
     to go round that one instead. **Leave gaps at doors** (and **windows**) changes the run right
     away.
   - **Under**, **Behind** or **Top edge** of a piece of furniture.
   - **Along a rail** runs it along a deck's or a mezzanine's railing, on the rail's top, and as
     plain wire where there's no rail.
   - **Draw** to press on a wall and drag, or tap points one at a time (double-tap or Done ends it).
3. Set its **height** with the chips (Toe-kick, Counter, Under cabinets, Valance, Cove, Ceiling
   edge) or in centimetres, and **which way it shines**.
4. **Remove run** puts it back to PadSpan's guess.

### Undo, Save, keyboard

- **Undo** and **Redo** step back and forward through everything you changed. **Discard** throws
  away what isn't saved (and Undo can still bring it back).
- **Save** writes it all at once. **Done** leaves Edit; with unsaved changes it asks first.
- Keyboard: **Ctrl+Z** (⌘+Z) undo, **Ctrl+Y** or **Ctrl+Shift+Z** redo, **Escape** lets go of
  what's picked (or a half-drawn line), **Delete** removes the door or window you picked.

### Furniture

**Mapping → Furnish** (see the [Furnish Guide](FURNISH_GUIDE.md)) adds furniture: build a sofa, bed, table and more with sliders, make one
from a photo, or find one in the shared library. Drag a piece across the floor (its back snaps to
the walls), use the arrow keys to nudge it (Shift for 10 cm) and **[ ]** to turn it. A piece can
be linked to a device ("This is a device…") so a lamp glows, a fan turns or a washer shakes when
the real one does.

---

## On a wall screen

- **Set as home** (Views ▾) the view you want the screen to rest on, and pick **Back to home view**
  in Settings. It flies home after that long untouched, and never while you're editing or have a
  card open.
- In the sidebar, the corner button makes it full screen. Zoomed in, the bars step aside for the
  map alone; **☰** brings them back.
- With nothing changing, Live Aboard draws nothing, so a quiet house costs the screen nothing.

---

## When something's off

- **It shows the flat map instead:** your browser or device couldn't run the 3D view (no WebGL,
  too slow, or its graphics restarted). The 🏠 button says why; tap it to try again.
- **A room's temperature shows "–°":** its sensor hasn't reported in over an hour.
- **A device floats in the wrong place:** set its height in Edit → Heights, or move it on the map.
- **A door or window is missing:** draw it in Edit, or on the map with its sensor linked.

See also the [Atlas Guide](ATLAS_GUIDE.md) for the flat map.
