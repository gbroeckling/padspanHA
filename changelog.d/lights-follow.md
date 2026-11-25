# Lights follow people

### New
- **Lights follow people (free, off until you turn it on).** PadSpan can switch room lights itself: a room's lights go on when someone with a named phone, watch or tag comes in, and off once nobody has been in it for the time you set (2 minutes unless you choose 30 seconds to an hour). Turn it on in Settings → Tracking → Home Assistant and integrations → Lights follow people, then add your rooms. Until you do, nothing changes.
- **Per room**: which lights (a new room starts with its Home Assistant area's lights), the off delay, only when dark (the sun down, or a light sensor below a level you set), and quiet hours in which nothing turns on.
- **It never fights a light switch.** A light someone turns off by hand while they are in the room stays off until everyone has left the room for a minute and someone comes back. A light turned on in a room nobody tracked has been in is never turned off.
- **No waiting for the room change.** A room change waits for Room Change Delay, so the light would come on late. Give a room its motion or occupancy sensor and the lights go on as soon as PadSpan's latest reading puts someone in that room and the sensor sees them.
- **Per person**: everyone you have named counts, except guest tags. Untick anyone (or a tag that stays put, like keys) who shouldn't switch lights, or tick a guest tag to let it.
- **Three Home Assistant blueprints** for people who prefer their own automations: room lights follow people, lights on in whichever room you walk into, and lights off when a room is empty. Import links are in the manual, chapter 14.
- **The opt-in usage report counts it**: lights turned on and off, a light left off because it was turned off by hand, an entry in quiet hours or daylight, an entry a sensor sped up, a light that didn't answer. Counts only, never a room, a name or a light.
