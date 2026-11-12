# Light switches in Live Aboard

### New
- **Light switches, in Live Aboard's ⋯ list on the Atlas tab and wall screens.** Tick Light switches (in the Lights group of ⋯ → Show on this screen) and a tap on a light or an LED strip in the 3D house turns it on or off, the same way a tap on the flat Map does: the light changes at once, settles to what Home Assistant reports, and goes back with a short message if it couldn't be switched. It is off until a screen ticks it, so a stray touch on a wall screen switches nothing. Holding a light still opens its brightness and colour. The flat Map is unchanged: a tap there always switches.

### Changed
- **A tap on a ceiling fan or a lock in Live Aboard opens its controls** instead of switching it, so a touch on a wall screen never turns a fan on or unlocks a door by itself. Holding still opens them too.
- **Mapping's 3D view no longer switches a light, a fan or a lock on a tap.** It is where the house is built, so a tap there never turns anything on; holding a light still opens its controls.
- With the usage report on, PadSpan counts a light switched by a tap in Live Aboard and one that couldn't be (`house3d_show:light_tap:ok`, `:failed`), and a screen turning Light switches on or off like every other ⋯ line. Counts only, never a name.
