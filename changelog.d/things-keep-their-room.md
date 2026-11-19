# Keys keep their room

### New
- **`last_room` on the area sensor and the device tracker:** the room the device was last seen in. It stays there after the device reads not_home, so an automation or a card can still say where it was left.

### Changed
- **Keys, tags and other things stay in their room for hours.** Every device used to switch to not_home 5 minutes after it was last heard, so keys in a drawer or a tag in a bag went "away" while they sat in the kitchen. Now only what a person carries does that. Anything nobody carries keeps the room it was last seen in for 6 hours, then switches to not_home. This is the area sensor and the device tracker in Home Assistant; the PadSpan panel, arrive and leave alerts and events are unchanged.
- **What counts as carried.** A device is carried when it is added to a person in Home Assistant (Settings → People → Track devices), is picked for them in Live Aboard (Furnish → People & devices), or has the person's name. A phone or watch that is none of these now counts as a thing: add it to its person so it goes away after 5 minutes again. The same goes for a car's tag, which would otherwise stay in the garage for 6 hours after the car leaves.
- **Choose the time** in Settings → Presence → Home/Away Timeout, under "Things keep their room": 0.5 to 48 hours, or 0 for the same as the away timeout (how it was before).
