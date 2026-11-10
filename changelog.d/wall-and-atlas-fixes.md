# Wall and Atlas fixes

### New
- **The scene row under Mapping → Atlas too.** The row of small scene maps now shows under the map in Mapping → Atlas and in its Live Aboard, as on the sidebar Atlas: Home Assistant's scenes with a placed light and the Whole house presets that light one floor. A tap runs one, again turns its lights off; administrators get ✎ and + New scene. That screen's ⋯ list can hide it.

### Fixed
- **⟳ 90° keeps the whole house above the scene row.** After turning the 3D house a quarter with ⟳ 90° (without Fit), a corner of the house could dip behind the row of scenes, on a wall too. A turn now frames the house again at its new angle, the way Fit does. Zoomed in, it turns as before; zoomed out, it stays as far out.
- **On a wall, the Motion chip fades with the other controls.** When nobody has touched the wall for 30 seconds, the bars, the compass and ⋯ fade away; the Motion chip used to stay. It now fades with them and comes back with them at the next touch.
- **On a wall, ⋯ Show on this screen fits without scrolling.** On a 1280×720 wall the list had to be scrolled. On a wall it now spreads across the screen in up to four columns with each line's plain name; a line that isn't set up keeps its short note. The rows are still big enough for a finger, and the alarms line is always there.
- **The Vacation banner stays in sight in full screen while a list is open.** In browser full screen, opening ⋯ Show on this screen or a menu sent Vacation Mode's banner behind the map. It now stays over the map, with the open list still on top where the two overlap. On a wall it already sat under the open list, and still does.
