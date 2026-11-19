# A wall draws the house as large as its screen allows

### Changed
- **A wall screen arranges the floors for its own shape, so the house fills the screen.** The flat Atlas on a wall (`?kiosk=1`) used the Spacing and L/R saved under Layout & view, one pair of numbers for every screen and for the Overview tab's map too. A spacing that suits a narrow map stacks the floors into a tall, thin tower on a wide wall, which then shrinks to fit its height: a small house with space either side. A wall now works out the arrangement itself each time it draws: on a wide screen the floors step sideways, on a tall one they stay a stack, and every room stays in sight. On a three-floor house on a 1080p wall that is about 40% larger than the saved spacing gave. The saved Spacing and L/R still set every other screen; moving either slider on the wall itself takes over there until Reset view.
- **A wall has no scroll bars.** Zoomed in, the map is dragged or pinched as before.

### New
- **A wall checks, after every drawing, that the house is as large as the screen allows.** If it ever opens far back (under 85% of that size), it moves in on the house by itself, and with the usage report on it says so once a page (`wall_fill:ok`, `low` or `closer`). `tools/wall_fill_check.py` runs the same check on the demo house or a real Home Assistant at any screen size.

### Fixed
- **Floors set far apart sideways draw properly.** A floor's plate is 18 units thick straight down (its sides used to slide sideways with the L/R spacing), and each floor's number badge stays at its own floor's corner (past the old 760-unit canvas they were pulled into a column over other floors' rooms).
