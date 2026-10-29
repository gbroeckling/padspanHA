# The stable after 0.38.166: everything from the last four days of betas

If you're on the stable channel, this is everything from 0.38.167 to 0.38.198 in one go.

### Things you'll notice
- **Your own house first.** A new install shows who's where in your home before any floor plan is drawn, and the map wizard puts your plan in place for you.
- **Vacation Mode** can't be turned off by accident. It also has options (after dark only, an end date, pause when someone is home, bedtime, the longest a light stays on) and a status sensor, `binary_sensor.padspan_vacation_mode`.
- **Improve accuracy tips on the Overview.** If your home skips floor heights, receiver heights or a real-world scale, a small card says so and takes you to the fix. Hide one tip, or the whole card.
- **Help in Dutch, German and French.**
- **Shelly scanners** find their Shelly by its address, and get their room without a restart.
- **Calibration** tells you a floor has no real-world scale before you stand still for a capture, not after.
- **Forensics stops recording when a licence or trial ends.** What it already recorded stays searchable.

### Live Aboard (the 3D house)
- **Stairs:** open stairs, treads only, Floating stairs (open treads on one steel spine), and stairs with two or three landings. Stairs can also come from your floor plans (AI, a first guess) or from rooms named for stairs. You can also have a few steps within one floor, such as up from a sunken garage.
- **Split levels.** In Mapping → Rooms, a room's floor can sit higher or lower than the rest of its floor. Stairs climb into it, and it sits on a short wall.
- **Settings → AI** holds the AI features: furniture from a photo, and stairs from plans. All are off until you turn them on.

### Off until you turn them on
- Guest tags.
- Optimize for scale.
- Calibration's Walk a room.

### Before you roll back
- **A house with a Floating staircase needs 0.38.196 or later.** Older versions can't save its 3D file. If you go back to an older version, set those stairs to another style first.

### Room timing
- **Room Change Delay now does what it says.** A delay of 0 used to act as 20 seconds; now 0 means a person's room changes as soon as PadSpan is sure. If you set 0 and rooms now switch too eagerly, set it to 10–20 seconds in Settings → Presence.

### Usage report (if you share it)
New counts, never names or places:
- the accuracy tips
- stairs and split levels
- rooms drawn over each other
- how recent fixes act in real homes
