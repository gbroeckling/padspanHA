# Audio on a wall: the room panel clear of the emergency button, the volume at once, the speaker its own badge

### Fixed
- **The 3D room panel never opens under the emergency button.** Where the emergency lighting button (or the alarm's shield in it) floats over the panel's corner, the panel now starts just below it, so the room's name and ✕ can always be seen and tapped, on a wall and on a phone. The flat map's room sheet already opened over it.
- **The volume number moves as soon as − or + is pressed.** Each press moves the level shown by one step at once (1 in 100 on a player that steps itself, such as a Control4 room), quick presses add up, and the row is no longer drawn again between presses. When Home Assistant reports a level, that is shown; if it reports nothing new, the pressed level stays for a few seconds and then Home Assistant's own comes back.
- **A room's speaker is a round badge of its own.** On the flat map and in the 3D view it sits beside the room's name and its readings (temperature, humidity, air) with a gap, never on them, so a reading no longer looks like a volume.
- **Rooms cleared on Audio's matching card stay cleared.** Once the card has kept a pick, it no longer brings its first guesses back when it opens again or when Audio is ticked.
- **A pick on the matching card keeps every other match.** A player Home Assistant isn't showing right now (hidden, not loaded yet), a Home Assistant speaker while those aren't offered, or a room renamed on the map keeps its match; such a player's list says "Not on the map" instead of nothing.
- **On the classic layout Audio has one switch.** Settings → Atlas → Audio now decides the 3D view's speakers too; the 3D view's ⋯ no longer offers a second Audio line there.
- **The matching card closes with the panel**, and a 3D speaker takes only a press on itself, no longer one a few pixels beside it meant for a door, a marker or a reading.
