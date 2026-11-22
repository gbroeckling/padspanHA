# 8. Rooms and floors come from Home Assistant

[Contents](README.md)

PadSpan has no room list of its own. Its rooms are your Home Assistant **areas**, and its floors are
your Home Assistant **floors**. You add, rename and remove them in Home Assistant, and PadSpan
follows. What PadSpan keeps for each room is what Home Assistant has no place for: its outline on
the floor plan, its colour, its ceiling height and the like.

## Rooms are areas

- **A receiver's room** is the area of its Home Assistant device. A receiver with no area gives no
  room, however well it hears you ([chapter 5](05-receivers.md#a-receivers-room-place-and-height)).
- **A device's room** is the room of the receiver that hears it best, or, with three or more
  receivers on a floor plan, the area whose outline it is in.
- **The room PadSpan reports** to Home Assistant (a tracker's state, an area sensor) is the area's
  name, written as Home Assistant has it: "Kitchen", not "kitchen".

So for rooms, every room you want told apart needs an area in Home Assistant, and a receiver in it
with that area. A room you only want on the map (a closet, a hall) needs an area and an outline, but
no receiver.

**Add areas** in Home Assistant: **Settings → Areas, labels & zones**. If Home Assistant has no
areas yet, the Overview's **Who's where now** card says so.

**Add one from PadSpan.** When you draw rooms in **Mapping → Edit** and the plan's floor has no
area left to choose, PadSpan says: "There is no room to choose for this floor yet: rooms are Home
Assistant's areas." Type a name and choose **Add to Home Assistant**: Home Assistant gets an area of
that name, on the plan's floor. A name that is already an area is used, never made twice. The room
helper Claude can draw with ([chapter 19](19-ai-features.md)) has the same offer.

## Floors are Home Assistant floors

Give each area its floor in Home Assistant (an area's **Floor**, under
**Settings → Areas, labels & zones**). PadSpan reads the floors and stacks them bottom-up:

1. by each floor's **level** in Home Assistant, when it has one;
2. otherwise by its name: basement and cellar go below, ground, main and first floor at ground
   level, outdoors at ground level too;
3. otherwise above the named ones, in the order they were made.

Set a level on every floor in Home Assistant and the order is never a guess. The order matters for
more than the picture: a signal that goes through a floor loses strength, and PadSpan counts the
floors in between from it.

**How far apart the floors are** is PadSpan's, not Home Assistant's: Setup's floor heights step
([chapter 9](09-setup-the-map.md#step-4-floors-and-their-heights)). A sync from Home Assistant
never overwrites them.

**Outdoors.** A floor called Outside, Outdoor, Outdoors, Exterior, Garden or Yard is treated as the
outdoor floor: at ground level, and drawn in the 3D view. The flat map doesn't show rooms on it.

**An area with no floor** is offered on every floor plan, and the **Rooms** screen says
**No floor set in Home Assistant**.

A house with one floor and no floors in Home Assistant works as it is: everything is on one floor.

## The Rooms screen

**Rooms**, in the menu, lists every room with what PadSpan keeps for it. The names and floors are
read only here; **Rename in Home Assistant** and **Add a room in Home Assistant** open Home
Assistant's own pages. Each room's row has its name and floor, its colour (**Room colour, on every
map**), and:

| Field | What it is |
|---|---|
| **Outline** | **Drawn** or **Not drawn**. **Draw outline** or **Edit outline** opens it on its plan in Mapping. |
| **Ceiling height (m)** | 1.5 to 30 m, or blank for the floor's height. **Save height**. |
| **Split level (m up or down)** | For a room a few steps up or down: up to 3 m up, 1.5 m down, or blank for level with its floor. |
| **Kind of space** | For a room on a house floor: indoors, or a covered or open deck or patio. **Work it out** guesses it from the house. |
| **Surface** | For an outdoor room: what the 3D view draws on its floor. |
| **Receivers** | The receivers in it. **See receivers** opens the Receivers screen. |
| **In it now** | Who is in it now, or **Nobody**. |
| **Lights** | The lights in it, as the Atlas counts them. |

Colour, ceiling height and split level save at once. An outline drawn on a plan goes onto the map of
the house only when you choose **Put it on the map**
([chapter 9](09-setup-the-map.md#finish-put-it-on-the-map)), never by itself.

## Renaming and removing

PadSpan knows a room by its name.

- **An area you rename in Home Assistant** is renamed in PadSpan too, while PadSpan is running: the
  room's outline, its details (colour, height), its neighbours, the receivers placed in it, its
  bounds on each floor plan, its calibration points (room walks too), Follow alerts that watch it,
  what PadSpan has learned about it, and the room–tag map. PadSpan makes an automatic backup first
  (**Before renaming room …** in the backup list) and writes one line in Home Assistant's log saying
  what it renamed. If PadSpan already has a room with the new name, nothing is renamed, since that
  would merge two rooms; the log says so.
- **Not renamed**: past records keep the name the room had then (movement history, lost-and-found,
  recordings and the time line), as do guest stays, a sub-zone's room label, the Live Aboard
  director's room list, the ESPresense room map, and the room names inside a saved RoomPlan scan or
  an AI plan's undo. Change those by hand if you need to.
- **A room that isn't an area any more**, such as one you removed in Home Assistant, or renamed
  while PadSpan was not running, shows on the Rooms screen as **PadSpan only, not a Home Assistant
  area**, with its outline kept. Draw the outline again for the new name and remove the old one in
  **Mapping → Edit**.
- **A receiver moved to another room**: change its device's area in Home Assistant, or in PadSpan
  with **Set room** on the Overview's **Who's where now** card.
- **An area you don't want** can be removed in Home Assistant, or with **Delete** in PadSpan's
  **Manage** screen, which asks twice. That deletes it from Home Assistant itself, not just PadSpan:
  every device and entity in it is left with no area.

## What PadSpan reads and never changes

PadSpan reads Home Assistant's areas, floors and device registry. It changes them only when you
press a button for it, one at a time: **Set room** or **Assign** for a receiver, a light's room,
**Add to Home Assistant** for a new area, **Delete** for an area on **Manage**. The full list is in
the README's [What PadSpan never touches](../../README.md#what-padspan-never-touches).
