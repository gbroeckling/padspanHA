# Let Claude draw your rooms: measure one thing first

### New
- **A plan with no scale can use Let Claude draw your rooms (experimental).** Before, the helper needed a plan whose scale was already set. Now it measures one thing with you first: click both ends of something you know the length of (a wall, a doorway, the whole house) and type its length, such as 4.2 m, 420 cm or 13' 9". It shows what it understood ("= 4.19 m") and how big that makes your plan, then "Save and find the rooms" goes straight on to Claude's read. Two taps put the two ends; drag an end, or tap near it, to move it. It works with a finger too.
- **It is saved exactly as Mapping → Edit → Measure saves a measurement**, through the same code. The house's metre scale is set from it only if your house has none yet. A plan that already has a scale skips this step, and nothing about it changes.
- **Which floor:** asked only when the plan's floor isn't one of your house's floors.
- **An odd size is a question, never a stop.** "That makes your plan 412 m across. Is the number right?" You can change the number or save it as it is.
- **Undo** on the last screen takes the rooms back first, then the measurement the helper made, so the plan has no scale again, as long as nothing measured in metres was added since (a room, a receiver, a calibration spot or another plan's scale). If something was, the measurement stays and the helper says so; change it in Mapping → Edit → Measure.

### Changed
- **The helper stops only to keep your data safe.** It won't measure a plan that already has a scale or calibration spots, a plan whose picture changed while you were on the screen, or a plan whose floor it doesn't know; and it saves nothing if the safety backup can't be made. A backup of your map, plans and calibration is taken before each save and each undo (the last six kept). A save cut short by a restart is finished or taken back the next time the helper starts.
- **Usage report (if you have it turned on):** whether a plan's scale was measured in the helper or was set already, how each scale save and undo ended, and, if you later measure a plan again by hand in Mapping → Edit → Measure, by how much the scale moved (under 1 %, 1–3 %, 3–10 %, over 10 %). That last one is how we'll learn whether one measurement is accurate enough. Counts and fixed words only, never a plan, a length or a floor.
