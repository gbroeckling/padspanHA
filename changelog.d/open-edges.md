# Open edges: rooms with no wall between them

### New
- **Open edges in Mapping → Edit → Signal walls.** Some rooms aren't divided by a wall: a loft, or one big open space. Signal already passes where no wall is drawn, for positioning and for the coverage map alike. What was missing was a way to say so without tracing the room's edge by hand. Now **Open edge: tap a room edge** snaps to the nearest saved room edge and puts an Open (0 dB) wall exactly along it, named "Open edge — <room>"; **Open all edges** does a whole room. An edge two rooms share is marked once. The 3D house leaves the wall out where an edge is open, as it did for open walls drawn by hand; a new open edge has no railing until one is chosen.

### Fixed
- **An open wall saved at 6 dB reads as open.** An old path could store an Open (Loft) wall with the default 6 dB loss. Open now means 0 dB whatever was saved, so positioning and coverage treat it as no wall.
