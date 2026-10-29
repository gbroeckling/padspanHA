# Fixes from the stable review

### Fixed
- **A device takes the room of the device it belongs to only if it is a Bluetooth scanner.** Since 0.38.176, any device with no area took its parent device's area. Now only the scanner devices Home Assistant's Bluetooth integration makes for each proxy do (as Home Assistant itself does when it sets them up). A plug behind a hub keeps having no room.
- **Calibration no longer says a floor has no scale while the house is still loading.** For a moment after the panel opened, a floor could be blocked for capture before PadSpan had read the floor plans.
- **Who's where shows only before any room is drawn,** counting rooms drawn on a floor plan as well (it used to count only the 3D rooms).
