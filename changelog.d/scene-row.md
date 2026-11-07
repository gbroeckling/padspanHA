# A row of lighting scenes under the Atlas and in Live Aboard

### New
- **Your lighting scenes as small maps.** Under the sidebar Atlas's map, and along the top of Live Aboard's bottom bar (above Walls, the floors and Iso / Top / Fit, never on them), a row of small maps, one per scene: Home Assistant's scenes that set a light you have placed, and your Whole house presets whose lights that are on all sit on one floor (marked Preset). Each map is that floor with its rooms: the scene's lights lit in their own colour where it is known (glowing while they are on now), every other light faint, its name underneath and On, Part on or Off beside it. A scene that reaches other floors shows the floor with most of its lights and says the others ("+ Upper"). Many scenes: the row scrolls sideways. On the sidebar's flat map the row waits at the bottom of the screen while the map runs on below it. It is on wherever the house has such a scene or preset, on the wall too.
- **Tap: on if mixed, then off.** A scene whose lights aren't all on runs (a preset is applied); once all its lights are on, a tap turns them off (a preset's: the lights it turns on).
- **Making scenes.** + New scene at the end of the row, and ✎ on a scene, open Home Assistant's own scene editor (administrators). A scene made in YAML or by another integration says so and opens Home Assistant's scene list. A preset's ✎ opens the Whole house bar on the same page with that preset chosen. Anyone who isn't an administrator is told an administrator makes scenes in Home Assistant. Settings → Atlas has a Scenes line with the same + New scene and All scenes.
- **⋯ → Scene row.** Any screen can hide the row from Live Aboard's ⋯ list (the flat map under it follows). With no scenes yet, the line says so, and Yes › opens the new-scene editor.
- **Opt-in usage report (counts only):** the row shown, a scene run or turned off (a Home Assistant scene or a preset), a new scene or an edit opened. Never a name.

### Changed
- **Railings in ⋯ takes stair rails too**, their spindles and posts with them (the steps stay), not only deck and open-edge rails.

### Fixed
- **A wall screen is never led away.** On /padspan-lights?kiosk=1, nothing in Live Aboard's ⋯ list or the scene row opens another page any more (a link used to leave the wall on the main panel with no way back). A line that isn't set up says plainly where to set it up from another screen ("Set it up from another screen, in PadSpan → Settings → Atlas → Outdoor weather").
