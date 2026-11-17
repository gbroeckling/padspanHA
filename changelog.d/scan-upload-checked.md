# Scan upload, checked before release

### Fixed
- **A scan file is at most 2.8 MB, and a larger one is refused in plain words.** Home Assistant drops anything bigger on the way in, so the earlier limit could never be reached: a 5 MB file just said "That didn't work". A whole floor's scan is usually under 2 MB.
- **The phone guide's link says why when it can't run.** Opened by someone who isn't an administrator, or on the demo house, it showed plain Mapping and nothing else. It now says what is needed, with a Close button, and waits for the house to load in place of giving up.
- **A damaged or oversized scan file can't tie Home Assistant up.** No more than a scan can hold is ever unpacked, whatever the file claims, and reading it stays quick however the file is made.
- **A scanned plan's furniture guide is dropped when its picture is trimmed, turned or extended**, in place of being drawn in the wrong spots.

### Changed
- **"Scan the floor with an iPhone or iPad"** in the ways to a plan: a scan gives the floor's walls, and you still say where each room is.
