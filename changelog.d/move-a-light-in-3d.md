# Move a light in the 3D editor

### Added
- **Mapping → Atlas builder → 3D look → Edit → Heights → "Move it".** A light, a sensor or a readout could have its height and its kind ("What is this?") set in the 3D look, but its place only on the flat map. Now: tap the device, press **Move it**, then tap its new place on the same floor.
  - The move is written to the device's place on the map at once. It is not part of the editor's Save, Undo or Discard; **Put it back** undoes the last move.
  - Its height and everything else about it stay as they are.
  - A tap on another floor is refused, with where a device changes floor (the flat map).
- **The Heights sheet says when a light is drawn away from where it is placed.** A strip, a sconce and a few other kinds are drawn on the nearest wall or round their room; when that is more than half a metre from the spot, the sheet says how far, and that "What is this?" changes it.
