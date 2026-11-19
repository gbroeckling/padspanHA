# A phone scan's doors and windows come into Live Aboard

### New
- **Import brings in a room scan's doors, windows and openings.** With RoomPlan import on (Settings → Features), Live Aboard's Furnish → Import used to take only the furniture and stairs from a RoomPlan scan, so every door and window had to be drawn again by hand. Now each door, window and opening in the scan (USDZ or JSON) comes in too, with its width, its height and, for a window, how high off the floor it starts. Heights are measured from the scanned room's floor.
  - A door comes in as a door (hinged left, swinging in, as a door you draw does), a window as a window.
  - An opening with no door in it that goes down to the floor (an archway) comes in as a doorway. One that starts higher up (a pass-through to the kitchen, say) comes in as a window at that height, listed as "Wall opening" so you can tell.
  - Each one goes on the nearest wall of the house, the same way doors and windows from a Sweet Home 3D file do. It keeps its width, moves along the wall only as far as it must to clear a corner or another door or window, and is cut only where the wall is too short for it.
  - It works best when the house's rooms were imported from the same scan, so the walls line up.

### Changed
- **The import says how many doors and windows have no wall to go on.** Any that are not near a wall of the house (more than 1 m away) are left out, and the line at the top of the list now counts them, for Sweet Home 3D files as well as scans. Each one is still listed with the reason.
