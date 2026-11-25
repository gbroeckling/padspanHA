# 18. Wall screens and kiosks

[Contents](README.md)

How to put PadSpan on a tablet or a screen on the wall and leave it there.

## The screen

PadSpan runs inside Home Assistant, so a screen only has to show Home Assistant full screen in a
current browser and take touch. The 3D house needs WebGL 2. Three common ways:

- **An Android all-in-one**: a kiosk browser such as Fully Kiosk Browser, or the Home Assistant
  Companion app set as the home app. One box, one cable.
- **A touch monitor and a small computer** (a mini PC or a Raspberry Pi) running a browser in kiosk
  mode. The most flexible.
- **A TV with an infrared touch frame**, plugged into a small computer by USB.

1080p is enough for most walls; 4K is sharper up close. Landscape and portrait both work. More on
choosing one: [Which touch screen for a wall?](https://padspan.traks.ca/guides/wall-screens/) and
[Every floor of a big house on one wall screen](https://padspan.traks.ca/guides/large-homes/).

## Which page to show

PadSpan has two pages in Home Assistant's sidebar:

- **PadSpan HA** (`/padspan-ha`): everything, with its menu.
- **Atlas** (`/padspan-lights`): the device map alone, made for a screen. It is on by default;
  **Settings → Atlas → Show the Atlas in the Home Assistant sidebar** turns it off or on (restart Home
  Assistant after changing it).

For a wall, the Atlas page is usually the one: the map fills the screen and the controls fold into a
slim rail down the left (☰ floors and device types, ★ presets, ⚙ zoom and view, 🏠 Live Aboard, ‹ to
hide the rail). The Atlas itself is in [chapter 15](15-the-atlas.md).

## Kiosk links for the main page

Add these to the PadSpan HA page's address:

| Address | What it does |
|---|---|
| `/padspan-ha?kiosk=1` | Hides PadSpan's own menu and bars, and never shows trial or invite offers |
| `/padspan-ha?view=follow` | Opens on one screen (`overview`, `follow`, `traceback`, `maps`…), whatever the browser last used |
| `/padspan-ha?view=maps&tab=lights&light=light.kitchen` | Opens Mapping → Atlas builder with one light picked |

They combine: `/padspan-ha?view=follow&kiosk=1`. To hide Home Assistant's own header and sidebar
too, use a kiosk add-on (such as kiosk-mode from HACS) or the tablet's kiosk browser.

**After an update**, a screen opened with `?kiosk=1` reloads itself once, so it never runs old code.
Any other browser shows a bar with a **Reload** button instead.

## Wall mode: `/padspan-lights?kiosk=1`

Open the Atlas page with `?kiosk=1` and it becomes a wall:

- the whole house fits the screen, every floor top to bottom, and the header goes;
- the rail, the legends, the 3D view's bars and room names and the rain grow with the screen: their
  usual size on 1080p, twice that on 4K, so it reads from across the room;
- the screen is kept awake while the page is open, if Home Assistant is reached over HTTPS (or on the
  screen's own `localhost`); otherwise use the screen's own sleep setting;
- Home Assistant's sidebar is hidden on that browser. **Show HA**, on the Atlas page opened without
  `?kiosk=1`, brings it back;
- the controls over the map fade 30 seconds after the last touch, and come back with the next.

Wall mode needs the Atlas's new layout, the one with the rail (PadSpan Pro:
**Mapping → Atlas builder → ▦ New layout**). With the classic layout, `?kiosk=1` only drops the header.

**Making the map fill the screen**: **⛶** (bottom right) makes it full screen. Zoom in past the whole
house and the bars step aside; **☰** or **Escape** brings them back. Double-tap a room to zoom to it.

## Sizing a wall for its room

**Settings → Atlas → Wall screens** sets how big a wall draws things:

- **Size from the screen** (the default): a 4K screen is twice a 1080p one.
- **Size for my room**: give the screen's size and how far away people usually stand, or tap a
  preset (desk monitor, kitchen tablet, hallway screen, living-room TV, big TV). Text is sized by how
  big it looks from there, so a 55-inch TV across a room gets much bigger text than a 27-inch monitor
  on a desk, though both are 4K.
- **Text size** (Small, Comfortable, Large) moves either one up or down.
- **Dim at night** darkens the wall between sunset and sunrise (it needs Home Assistant's Sun).
- **Protect against burn-in** moves the picture a couple of pixels every few minutes, for OLED
  screens.
- **Show each floor** (off until set): every 15 s to 5 min, the wall shows the next floor. It waits
  while someone is using the wall.
- **On Fully Kiosk tablets** (off until set): inside Fully Kiosk Browser, night dimming turns the
  screen's own brightness down, and with Fully's **Motion Detection** on, someone walking up wakes a
  sleeping screen. It needs **Enable JavaScript Interface** in Fully's Advanced Web Settings.

The card's preview shows a 4K screen to scale, with the text's height in centimetres. Walls pick up a
change within half a minute.

**One screen, its own size**: the card builds a link for one screen, for example
`/padspan-lights?kiosk=1&wall_in=55&wall_m=2.5` (55 inches, people 2.5 m away); add `&wall_text=24`
for larger text. A screen opened with its own link ignores the house setting.

## Portrait walls

A screen hung tall works as well as a wide one, sized the same either way up.

- If the TV or stick turns its picture when the screen turns, nothing needs setting.
- Most TVs and sticks can't. Hang it on its side and use **Settings → Atlas → Wall screens → Screen
  orientation → Portrait: turn the picture clockwise** (or anticlockwise). That adds
  `&wall_rotate=90` (or `270`) to that screen's link. If the map comes out upside down, use the other
  one.

## Live Aboard on a wall

- Get the view you want and pick **Views ▾ → Set as home**.
- In **Settings → Atlas → Live Aboard**, set **Back to home view** (30 s, 1 min, 5 min, or off). The
  screen flies home after that long untouched, never while someone is editing, has a card open, or
  made it full screen by hand.
- When nothing moves, Live Aboard draws nothing, so an idle screen costs almost nothing.
- On **Auto** or **High** quality, a wall draws at every pixel the screen has. A graphics chip too slow
  for that draws a softer picture while the camera moves, then about 1440p's worth, then Auto drops to
  Low and High to the flat Atlas. **Low** stays Low on every screen.

More in [chapter 16](16-live-aboard.md).

## Several screens at once: Optimize for scale

Every screen showing the Overview, or the 3D view with people, asks Home Assistant for the whole live
picture every 5 seconds: in a busy house, every passing Bluetooth device, about 2.2 MB a screen. Four
screens then move about 14 Mbit/s all day. The flat Atlas wall (`?kiosk=1`) doesn't ask for it.

**Settings → Tracking → Performance → Optimize for scale** (off by default) cuts that down:

- **A slim update**: the Overview and the 3D people ask only for what they draw (people, tags,
  named and followed devices, anything placed in a room) plus the counts: about 50 KB instead of
  2.2 MB in a real house.
- **One build for every screen**: screens asking within 4.5 seconds of each other share one build.
- **Nothing while a screen is off**: a hidden page asks for nothing until it is shown again.

Every other screen still gets everything. With it on, the list behind the Overview's objects count
shows only what the slim update carries. More in [chapter 23](23-performance-and-small-machines.md).

## Tips

- On an old or slow tablet, leave Live Aboard on **Low** quality.
- The **Test emergency lighting** button sits at the top right of the Atlas. On a screen anyone can
  tap, hide it ([chapter 15](15-the-atlas.md#emergency-lighting-test)).
- Your house alarm inside it works on a wall screen as anywhere (PadSpan Bright and Pro): every arm
  and disarm asks first, with the code when the alarm wants one, and nothing on its card leaves the
  page ([chapter 13](13-alerts.md#your-house-alarm-on-the-emergency-button)).
- Who can change what from a shared screen: [chapter 21](21-users-and-security.md).
