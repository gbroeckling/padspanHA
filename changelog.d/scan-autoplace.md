# A room scan finds its own place

### Added
- **A scan uploaded to a floor that already has rooms is placed where it fits.** A scan is in true metres and so are your rooms, so PadSpan lays the scanned room over each drawn room of about its size, at each quarter turn and a little either side, and puts the new plan where the two cover each other best. It says where it went and compares the sizes: "the scan measures 5.7 m by 4.4 m, and Dining Room is drawn 5.9 m by 4.5 m". Where a drawn room is more than a tenth off the scan's measured size, it says the drawn room is off.
- **Only the new plan is placed.** No room, receiver, calibration point or other plan is moved. A scan that fits nowhere, or two rooms equally, is not placed: it starts where every new plan does and says so.
- **A plain rectangle fits both ways round**, so it says to check the doors are on the right walls. Where the 3D house has doors and windows drawn, they settle it.

### Usage report (opt-in)
- Whether a scan was placed, placed with its outline fitting both ways, or not placed; and whether the drawn room was over a tenth off the scan's size. Words only.

### Changed
- **Furnish's Build menu offers "Place the scan's guess"** for the floor showing, so a floor with nothing placed can be filled from its room scan without picking a piece first.
