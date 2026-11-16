# Room scans, tuned against real files

### Changed
- **A scanned plan shows the furniture, faintly.** Tables, sofas, beds and the rest are drawn as light outlines where the phone found them, so the plan is recognisable at a glance. Walls stay the darkest thing on it.
- **An L-shaped or stepped room keeps its true outline from a USDZ.** It was read as its bounding rectangle.
- **The scan's wall heights are kept from either file**, USDZ or JSON. Several heights in one room mean a sloped or stepped ceiling.
- **A file that isn't a room scan is refused in plain words**, saying what to share from the scanning app in its place: another tool's own JSON, or a 3D mesh scan with no walls in it.
- **Live Aboard's import takes a RoomPlan USDZ as well as its JSON**, while RoomPlan Import is on in Settings.
