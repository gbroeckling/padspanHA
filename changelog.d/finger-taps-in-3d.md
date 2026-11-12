# Taps on lights in the 3D look

### Fixed
- **A tap on something the device filter has dimmed now says why nothing happened.** With one of the ☰ chips picked (Lights, Motion, Temps and so on), everything else is dimmed and takes no taps. In the Atlas's 3D look that was silent: a wall left on Motion looked as if its lights were broken. A tap on a dimmed device now shows "Only Motion takes taps now: the rest is dimmed." with a **Show all** button that puts the filter back to All.
- **A tap with a finger switches the light in the 3D look even if the finger rolls a little.** If it moved more than 8 pixels (about 3 mm on a wall screen) the tap was treated as the start of a turn of the house and did nothing. A finger may now move up to 16 pixels and still count as a tap. A mouse is unchanged, and so is the flat Map.
