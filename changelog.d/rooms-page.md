# A Rooms page

### New
- **Rooms, one page for every room.** A new Rooms screen in the menu's Setup group, in every mode (Basic included: Basic's Mapping has no Edit or Rooms tab, so this is its only room-by-room screen). Each room is listed under its floor, with its colour, whether its outline is drawn (and its size in m² when it is), its ceiling height, its split level, how many receivers are in it and who is in it now.
- **Edit in place.** The colour, the ceiling height and the split level save right there, the same way Settings → Appearance and Mapping → Rooms save them, so all three screens always show the same values. Nothing new is stored.
- **Rooms are still your Home Assistant Areas.** Names and floors come from Home Assistant: "Rename in Home Assistant" and "Add a room in Home Assistant" open its Areas page, and Refresh reads the change back. A room drawn only in PadSpan's layout is listed too, marked as not an area.
- **Edit outline** opens Mapping → Edit on the floor plan the room is drawn on, with the Rooms tool on and that room chosen. In Basic it switches to Advanced first and says so, as Mapping's own Open does. **See receivers** opens the receiver list.
- Settings → Appearance's Rooms card, Mapping → Rooms and Mapping → Edit's Rooms tool each have a small **All rooms** link to the new page. They keep their own controls.
- In Sample mode your own rooms are listed read-only, with a note, and without the demo house's people in them.

### Opt-in report
- Opening the Rooms page is counted like every other screen (from the menu or an All rooms link), and each colour, ceiling height or split level saved on it is counted (only that it happened, never the room or the value).
