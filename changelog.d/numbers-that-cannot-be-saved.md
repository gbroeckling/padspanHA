# A number too large to save is refused

### Fixed
- **A number too large to be saved no longer stops PadSpan saving.** A few places took a whole number of any size: the headcount you train the occupancy estimate with, a storey's level in Floor Heights, and the setup helper's snooze count. Sent a number larger than Home Assistant can write (by a script or an automation calling PadSpan directly; the panel never sends one), PadSpan kept it, and from then on every save of its settings or of the house model failed until Home Assistant restarted, losing every change made meanwhile. The headcount is now a whole number from 0 to 1,000, a level is between -1,000 and 1,000, and a capture's page offset can no longer ask for a page past the end of any capture.
