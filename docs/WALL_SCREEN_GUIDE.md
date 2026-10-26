# Wall Screen Guide

How to put PadSpan on a tablet or a screen on the wall and leave it there.

## Which page to show

PadSpan has two pages in the Home Assistant sidebar:

- **PadSpan HA** (`/padspan-ha`): everything, with its menu.
- **Atlas** (`/padspan-lights`): the device map alone, made for a screen. Turn it on in
  **Settings → UI Structure → 💡 Atlas — Mapped Light Control → Show the Atlas in the Home
  Assistant sidebar** (restart Home Assistant once).

For a wall screen the Atlas page is usually the one you want: the map fills the screen and the
controls fold into a slim rail down the left (☰ floors and device types, ★ presets, ⚙ zoom and
view, 🏠 Live Aboard, ‹ hide the rail).

## Kiosk links for the main page

Add these to the PadSpan HA page's address to open it ready for a screen:

| Address | What it does |
|---|---|
| `/padspan-ha?kiosk=1` | Hides PadSpan's own menu and chrome, and never shows trial or invite offers |
| `/padspan-ha?view=follow` | Opens on one view (any view's id: `overview`, `follow`, `traceback`, `maps`, …), whatever the browser last used |
| `/padspan-ha?view=maps&tab=lights&light=light.kitchen` | Opens Mapping → Atlas with one light picked |

You can combine them: `/padspan-ha?view=follow&kiosk=1`. To hide Home Assistant's own header and
sidebar as well, use a kiosk add-on for Home Assistant (for example kiosk-mode from HACS) or the
tablet's own kiosk browser.

## After an update

A screen opened with `?kiosk=1` reloads itself once after PadSpan updates, so it never runs old
code. Any other browser shows a bar with a **Reload** button instead.

## Wall mode: `/padspan-lights?kiosk=1`

Open the Atlas page with `?kiosk=1` and it becomes a wall: the whole house fits on the screen
(all its floors, top to bottom), the header goes, and the rail, the legends, the 3D view's bars and
room names, and the rain grow with the screen. On a 1080p screen everything is its usual size; on
a 4K screen it is twice the size, so it reads from across the room. The screen is also kept awake
while the page is open, if Home Assistant is reached over HTTPS (or on the screen's own
`localhost`); otherwise set the screen's own sleep setting. The first-time Live Aboard card isn't
shown on a wall, since nobody is there to tap it.

Wall mode needs the Atlas's new layout, the one with the rail (PadSpan Pro: **Mapping → Atlas →
▦ New layout**). With the classic layout, `?kiosk=1` only drops the header.

### Sizing a wall for its room

**Settings → UI Structure → Wall screens** sets how big a wall draws things.

- **Size from the screen** (the default): a 4K screen is twice a 1080p one.
- **Size for my room**: give the screen's size and how far away people usually are (or tap a
  preset: desk monitor, kitchen tablet, hallway screen, living-room TV, big TV). PadSpan sizes the
  text by how big it looks from there, the rule control rooms use, so a 55-inch TV across a room
  gets much bigger text than a 27-inch monitor on a desk, even though both are 4K.
- **Text size** (Small, Comfortable, Large) moves either one up or down.
- **Dim at night** darkens the wall between sunset and sunrise (it needs Home Assistant's Sun).
- **Burn-in protection** moves the picture a few pixels every few minutes, for OLED and plasma.

The card's preview shows a 4K screen to scale, and the text's height in centimetres. Walls pick up
a change within half a minute.

Each screen can also have its own size. The card builds the link, for example
`/padspan-lights?kiosk=1&wall_in=55&wall_m=2.5` (55 inches, people 2.5 m away); add `&wall_text=24`
for larger text. A screen opened with its own link ignores the house setting.

On a wall, the controls over the map fade out 30 seconds after the last touch, mouse move or key,
and come back with the next one.

Two more options in **Settings → UI Structure → 📺 Wall screens**, both off until you set them:

- **Show each floor**: every 15 s to 5 min the wall shows the next floor (All, then each floor on
  its own), flat map and Live Aboard alike. It waits while someone is using the wall.
- **On Fully Kiosk tablets**: inside [Fully Kiosk Browser](https://www.fully-kiosk.com/), night
  dimming turns the screen's own brightness down instead of laying a dark film over the picture,
  and its brightness comes back at sunrise. With Fully's **Motion Detection** on, someone walking
  up turns a sleeping screen back on. Needs **Enable JavaScript Interface** in Fully's Advanced
  Web Settings.

## Making the map fill the screen

- **⛶** (bottom right of the map) makes it full screen.
- Zoom in past the whole house and the bars step aside so you see only the map. **☰** or
  **Escape** brings them back.
- Double-tap a room to zoom to it.

## Live Aboard on a wall

With [Live Aboard](LIVE_ABOARD_GUIDE.md) on:

- Get the view you want and pick **Views ▾ → Set as home**.
- In **Settings → UI Structure → 🏠 Live Aboard**, set **Back to home view** (30 s, 1 min or 5 min).
  The screen flies back home after that long untouched. It waits while someone is editing, has a
  card open, or made it full screen by hand.
- When nothing is moving, Live Aboard draws nothing, so an idle screen costs almost nothing.

## Several screens at once: Optimize for scale

Every screen showing the Overview, or the Atlas's 3D view with people, asks Home Assistant for the whole live picture every 5 seconds. In a busy house that is every passing Bluetooth device: about 2 MB a screen, so four screens move about 14 Mbit/s between Home Assistant and the screens, all day. The flat Atlas wall (`?kiosk=1`) doesn't ask for it at all.

**Settings → Optimize for scale** (off by default) cuts that down:

- **A slim update:** the Overview and the 3D people ask only for what they draw (people, tags, labelled and followed devices, anything placed in a room) plus the counts. In a real house that was about 50 KB instead of 2.2 MB.
- **One build for every screen:** screens polling within 4.5 seconds of each other share one build, so Home Assistant does about the same work for four screens as for one.
- **Nothing while a screen is off:** a page that is hidden (display off, tab in the background) asks for nothing until it is shown again.

Every other view (Monitor, Devices, Bluetooth and the rest) still gets everything. With it on, the list behind the Overview's objects count shows only what the slim update carries.

## Tips

- On an old or slow tablet, turn **Low-memory mode** on in Settings → Presence if Home Assistant
  itself runs on a small machine, and leave Live Aboard on **Low** quality if the screen struggles.
  See [Minimum Requirements](MINIMUM_REQUIREMENTS.md).
- The **Test emergency lighting** button sits top right on the Atlas. If the screen is somewhere
  anyone can tap it, hide it in Settings (see the [Atlas Guide](ATLAS_GUIDE.md#emergency-lighting-test)).
