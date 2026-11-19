# Unlock asks first; white bulbs, Details and a live room sheet in the Atlas

### New
- **Warm or cool white for bulbs that do it.** Hold a light (or tap its code) on the Atlas: a bulb that can go from warm to cool white (Hue White Ambiance and the like) now has a colour temperature slider over its own range, plus Warm and Cool buttons when it has no colour. Before, it had brightness only. A colour bulb that also does white gets the slider beside its colour.
- **Details.** The bottom of a light's, fan's or lock's card has a Details link that opens Home Assistant's own window for it: history, settings and anything the card doesn't show. Not on a wall screen (`?kiosk=1`), where nothing leads off the page.
- **Who is in the room.** Tap a room's name: under its title the sheet now says who PadSpan places there ("Here: Alex, Sam"), the same people Overview's Occupancy card lists. Only on a screen that shows people: with Show people on (PadSpan Pro), and People left ticked in that screen's ⋯ list. Where people are hidden, the sheet names no one.

### Changed
- **Unlock asks first.** Unlocking a door from the Atlas, the 3D house or a room's list now asks "Unlock Front Door?" with Unlock and Cancel. Cancel sends nothing. Lock never asks.
- **The room sheet keeps up.** While it is open it now shows the room as it is now, not as it was when you opened it. "All lights on" is there only while a light is off, and "All lights off" only while one is on; the fan buttons work the same way. They switch only the lights that would change.
- **Unavailable lights are greyed out.** A light Home Assistant can't reach says "Unavailable" in its card and in the room sheet, with its buttons and sliders greyed out, and "All lights on" leaves it alone.

### Fixed
- **A switch that failed in a room sheet no longer shows the new word.** A light's button there kept saying "On" when Home Assistant refused; it now goes back to what it was.
- **A white-only bulb no longer offers a colour picker** it can't use while it is on.
