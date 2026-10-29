# The usage report says where recent fixes acted

### Changed
- **Usage report (if you share it):** three recent fixes now say when they act, so they can be checked in real homes before the next stable:
  - a Shelly's Bluetooth scanner found by the Shelly's network address (0.38.175), and a scanner given its Shelly's room (0.38.176), counted per home;
  - Forensics switched on but paused because the licence no longer reaches Pro (0.38.191);
  - the stale-receiver list in Mapping → 3D Stack opened (0.38.170).
  Counts only, never which scanner, room or receiver.

### Fixed
- **The new room-overlap count stays quick on very big houses.** It compares only rooms whose outlines come near each other: 600 rooms of 40 corners take about 20 ms.
