# 16. Live Aboard

[Contents](README.md)

Live Aboard is the Atlas in 3D: your floors, rooms, walls, doors, windows, lights and sensors as a
small house you can turn, zoom and tap, the way you'd look into a house in The Sims. It is built from
the map you already drew, so there is nothing new to set up before you see it. From December 1,
2026, it is free, with no key; PadSpan Pro adds Furnish, people figures, the 3D editor and the
director (and the library). Until then it comes with PadSpan Pro and is marked **experimental**. If
something looks wrong in your house, please say so ([chapter 27](27-getting-help.md)).

## Turning it on

1. Open **Settings → Atlas** and find **Atlas — Mapped Light Control**.
2. Under **Live Aboard**, turn on **Show Live Aboard on the Atlas**. It saves at once. From
   December 1, 2026, a new install starts with it on, and an install with no key has it turned on
   once by itself; a screen still opens on the flat map until 3D is picked there.
3. Open the Atlas. In the sidebar Atlas, tap **🏠** on the left rail to switch between the flat map
   and Live Aboard. In **Mapping → Atlas builder**, use the **Map | Live Aboard** switch beside the
   zoom.

The same card has:

- **Rain and snow** (PadSpan Pro): falls outside the house when the Atlas's weather says so.
- **Look**: the Atlas's colours, Live Aboard's own, or **Studio** (its own colours on a stage under a
  sky that follows the sun, with soft light and shadows).
- **Back to home view**: how long the sidebar waits untouched before it flies back to its home view
  (Off, 30 s, 1 min, 5 min).
- **Show people** and **Show tags & scanners**, on the map and in Live Aboard (PadSpan Pro).

**Set it up step by step** on that card (or **Set up Live Aboard** at the top of the Atlas builder;
PadSpan Pro) opens a wizard that builds the house with you: floor heights, rooms, devices, heights,
doors and windows, LED strips, furniture, the extras, and making it your screen (**Show the Atlas as
Overview**). Each step says what it found and what's left.

If 🏠 is greyed out, the reason shows beside it (a browser without WebGL, say). Tap it to try again.

## Getting around

In the sidebar, Live Aboard opens on every floor, pulled apart (**⇕ Explode**), with the page's bars
out of the way. **☰** (top right) brings the bars back.

| To... | Do this |
|---|---|
| Turn the house | Drag with one finger or the left mouse button |
| Move it | Two fingers, or the right mouse button |
| Zoom | Pinch, or the mouse wheel |
| Go to a room | Double-tap it, or pick it in **Rooms ▾** |
| Look straight down / back to the usual angle | **Top** / **Iso** |
| Turn a quarter | **⟳ 90°** |
| See all of it | **Fit**, or **Views ▾ → Whole house** |
| North up | Tap the compass |

**Walls** (bottom left): **Cut** lowers the walls in front of you; **Up** stands every wall at full
height (best from outside, and at night); **Down** lays them all low; **Glass** makes the walls in
front of you see-through, so rooms keep their height; **Roof** shows the roof from outside, or never.

**Floors**: **▲ / ▼** step a floor up or down and hide the floors above; **All** shows every floor;
**⇕ Explode** (with All) pulls them apart. On a keyboard, **PgUp / PgDn** change floor and **Home**
shows them all. Tap a floor's name for its sheet.

**Views ▾** has every floor, **Whole house**, and views you keep with **Save this view**.
**Set as home** makes the current view the one the sidebar opens on and goes back to.
**Views ▾ → Look** picks this screen's colours: **Same as Settings**, **Classic**, **Studio**, or a
Showcase theme. Tick **By the sun** for one look by day and another after sunset.

**Rooms ▾** lists every room under its floor. Pick one: the view flies to it and its panel opens,
with the room's devices and buttons (each switch with **Undo**), its scenes, and
**More devices of the area**: what Home Assistant has in that area that the map doesn't show. On a
wide screen, **Room chips along the top** in **⋯** puts the room names in a row instead.

## Walking through the house

**Walk** (bottom right; on a narrow screen, in **View ▾**) puts you in the house at eye height, just
inside the front door, or in the room you have open. Every floor shows and every wall stands while
you walk.

| To... | Do this |
|---|---|
| Walk | **W A S D** or **↑ ↓** on a keyboard; on a touch screen, push the stick (bottom left) |
| Turn | **← →**, or drag |
| Look round, up and down | Drag with a finger or the mouse |
| Hurry | Hold **Shift** |
| Go back to the 3D view | **✕ Stop walking** (top right), or **Esc** |

Walls, railings, window sills and closed doors stop you. A door with a sensor opens when the sensor
says it is open; a door with no sensor stands as its sheet says (ajar inside, shut on an outside
wall). Stairs take you up to the floor they reach and back down. Out through an open outside door,
you are on the ground round the house. Furniture does not stop you. The stick shows on a touch
screen, or as soon as you touch the view.

**Stop walking** puts the camera, the floors (pulled apart or not) and the walls back as they were.
Standing still, Live Aboard draws nothing, as it does when you are not walking.

## Reading the house

What you see depends on how close you are:

- **The whole house**: a tag beside each floor with what's going on ("Main · 3 lights on · 1 open ·
  2 people"). Tap it to see that floor alone.
- **One floor**: room names, readings and sensor markers.
- **One room** (double-tap or zoom in): the device codes in that room; the others fade back.

Alarms (leak, smoke, gas, CO) always show: rings across the room's floor and a red word over
everything (**WET**, **SMOKE**, **GAS**, **CO**, or **ALARM** while latched), until it is reset from the
banner.

- **Lights** glow in their own colour and brightness. A light that's off is a small dark fixture.
- **Room readings** (temperature, humidity, air quality) show under the name. One that hasn't come in
  for over an hour shows a dash ("–°"), so you never read an old one as current.
- **Motion**: a sensor tripping now is a bright blue badge and tints its room. One that tripped
  earlier is ringed in its age colour, from blue (just now) to red (about 2 hours). A dashed line
  drops from each badge to where the sensor really is. The **Motion chip** at the top names the
  newest rooms ("Kitchen now · Hall 12 min").
- **Heat map**: ☰ → **Temps** colours each room with a thermometer: blue when cool, green around
  21°, red from 26°.
- **Window open in the rain**: an open window glows blue and a line under the Motion chip names it.
  It needs the window drawn with its sensor linked, and the Atlas's weather set up.
- **At night** the house darkens with the real sun, and with the walls up the windows of lit rooms
  glow.
- **Doors and windows** linked to sensors open and shut as they do. A lock linked to a door glows red
  while unlocked.

**Mezzanines and galleries**: make one a floor of its own in Home Assistant. In
**Mapping → 3D Stack → Floor Heights**, give the hall under it its full height and the mezzanine its
real base elevation; Live Aboard then draws it inside the hall. Mark an open edge in
**Mapping → Edit → Signal walls** (**Open edge: tap a room edge**) and press **Railing** on its row
for a railing ([chapter 10](10-walls-and-signal-loss.md#open-edges-rooms-with-no-wall-between-them)).

## Using it

- **Tap a light** to switch it; **hold** it for brightness, colour and effects.
- **Tap a sensor or a reading** for its card; a motion sensor's opens its activity calendar.
- **Tap a room's name** for its sheet: every device, **All lights on / off**, fans, and the room's own
  scenes and scripts.

## Building: doors, windows, heights and strips

Building happens in **Mapping → Atlas builder**, in Live Aboard, with **Edit** (PadSpan Pro).
Nothing is stored until you press **Save**. **Undo**, **Redo** and **Discard** step through your
changes; **Done** leaves Edit and asks first if something isn't saved. Keys: **Ctrl+Z** undo,
**Ctrl+Y** redo, **Escape** lets go, **Delete** removes the picked door or window.

**Doors, windows and doorways**

1. **Edit**, then **Door**, **Window** or **Doorway**. The view looks straight down.
2. Press on a wall and drag along it, or tap its two ends. The length shows, in 5 cm steps.
3. Let go: the opening's sheet opens. A door has a height, a **Type** (hinged, double, sliding, barn,
   pocket, bifold, garage, gate and others), hinge and swing, and **Follows**: a door or garage
   sensor, or a cover, so it opens and shuts as that does. A window has **Sill** and **Head** heights.

Move or reshape a room in **Mapping → Layout** and its doors and windows go with it when you press
**Save corrections**. Any that can't are left where they were, and the message says how many.

**Heights**: **Edit → Heights**, tap a device, and use the slider or a spot offered for its kind
(**Ceiling**, **Corner**, **High on the wall**, **Switch height**, **Table**, **Floor**…).
**Reset to default** puts it back; for a light, **What is this?** says what it is (a pot light, a
pendant, a lamp). These are the same heights as the Atlas builder's **Height** row.

**Strips** (LED strips, valances, coves, string lights): **Edit → Strip**, tap the light or pick it
from **Lights to lay out**, then **Round this room** (with **Leave gaps at doors** and windows),
**Under**, **Behind** or **Top edge** of a piece of furniture, **Along a rail**, or **Draw**. Set its
height (Toe-kick, Counter, Under cabinets, Valance, Cove, Ceiling edge, or centimetres) and which way
it shines. **Remove run** puts it back to PadSpan's guess.

**Furniture**: **Mapping → Furnish**, [chapter 17](17-furnish.md).

## Building from your plans with an AI (experimental)

Three tabs under **Edit → Plans** read your floor plans with an AI. Each is an experiment: the AI
gets things wrong, so check every item. They need PadSpan Pro and switches in **Settings → AI**
([chapter 19](19-ai-features.md)). A cloud AI gets a copy of the plans it reads.

- **Plans** (needs **AI map-building research (experimental)** and an AI Task): the AI marks stairs,
  and if you tick **Lights**, light symbols, as numbered pins over your plan. Go through them one at
  a time (**New**, **Correction**, **Failure**, **Looks right**, **Later**); there is no accept-all.
  On a small local AI about 2 in 10 stair suggestions are wrong. It never places or moves a light,
  and only ever writes your 3D house.
- **Line up plans** (needs **Build from plans** and Claude Opus 5.5 or newer through Home Assistant's
  Anthropic integration): lines up several plans of one floor (a measured one, an architect's sheet,
  a scan). Only a plan's picture moves; calibration points, rooms, receivers and the plan that set
  the scale stay where they are. Each save takes a safety backup first.
- **Rooms from plans** (same switch): Claude reads each plan twice and proposes outlines for the
  rooms you already have, matched by where they lie, never by name. Rooms both reads agree on are
  ticked; **Look closely** shows where they differ, and **Read again** makes a third read.
  **Accept all for this floor** saves after one backup; **Undo this rooms session** takes it back.

## On a wall screen

- **Set as home** the view the screen should rest on, and pick **Back to home view**. It flies home
  after that long untouched, never while you are editing or have a card open.
- The corner button makes it full screen.
- With nothing changing, Live Aboard draws nothing, so a quiet house costs the screen nothing.

More in [chapter 18](18-wall-screens-and-kiosks.md).

## When something's off

- **It shows the flat map instead**: the browser couldn't run the 3D view (no WebGL, too slow, or
  its graphics restarted). The 🏠 button says why; tap it to try again. More in
  [chapter 26](26-troubleshooting.md#the-3d-house-wont-start).
- **A room's temperature shows "–°"**: its sensor hasn't reported for over an hour.
- **A device floats in the wrong place**: set its height in **Edit → Heights**, or move it on the
  map.
- **A door or window is missing**: draw it in Edit, or on the map with its sensor linked.
