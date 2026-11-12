# Tapping lights in Live Aboard; ⋯ on the flat Map

### New
- **⋯ on the flat Map too.** The Atlas's flat Map (the sidebar and wall screens) has the same ⋯ "Show on this screen" list as Live Aboard, at the foot of the controls rail on the left, with the lines that change the flat Map: Tap a light to switch it, Scene row, and Other floors, faded. It works with Live Aboard turned off, and a tick made in either look applies to that screen's other look.
- **Tap a light to switch it**, a new line in ⋯. It is on, as before: a tap on a light switches it on the flat Map and in Live Aboard. Untick it on a screen (a wall in a busy room, say) and a tap on a light switches nothing there, in either look; holding a light still opens its brightness and colour. Mapping is unchanged.

### Fixed
- **Live Aboard: a tap on a light you can see switches it.** A light whose nearest point was hidden behind a wall, a light on a wall that is cut away (its glow on the floor is what shows, and now takes the tap), and a light with a temperature chip, a sensor or a room name nearer the tap all used to miss. A light now wins a tap within its reach on the Atlas tab and its walls; where lights on two floors line up on screen, the chosen floor's (or the front one) wins.
- **Live Aboard: a tap that switched a light shows it**, with a ring that opens out once from the light, so it is seen even when the light is far off.
- **Live Aboard: Vacation Mode's banner and the Find toast no longer catch taps meant for the house** over the 3D view; only their buttons and slider do.
- With the usage report on, PadSpan counts a light switched by a tap in Live Aboard and one that couldn't be (`house3d_show:light_tap:ok`, `:failed`), a screen unticking or ticking Tap a light to switch it, and ⋯ opened on the flat Map (`house3d_show:opened:flat`). Counts only, never a name.
