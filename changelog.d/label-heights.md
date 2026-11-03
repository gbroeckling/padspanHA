# Live Aboard: a raised marker moves clear of the words around it

### Changed
- **A motion sensor's marker no longer sits on top of a room's name.** A marker on its dotted line, with its code under it, now picks a height on that line that clears room names, readouts, device codes and tags' names. Your sensor's stored height and spot don't change: this is only how it's drawn, nothing is saved, and while you edit, everything stands at its real height.
- **It works out the height for the view you're looking at.** It looks once the camera stops, or when what's showing changes, then moves in a short glide. Nothing hops while you turn the house, and a poll with no changes moves nothing. If nothing clears, it takes the spot that covers the least.
- **Looking straight down, the marker leans.** From Top, a height doesn't move anything on screen, so the marker slides a little to one side and its dotted line slants back to the ring on its true spot.
- **A tag's name does the same on its stem**, when Show tags & scanners is on, unless the tag is walking.
