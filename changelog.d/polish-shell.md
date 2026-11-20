# The panel's frame tidied: phone bars, loading, tab strips

### Fixed
- **The phone's top bar and bottom tab bar match the page.** With the 2025 panel style (Settings → Appearance → Panel Style) both bars were brown against a green-black page, as if they belonged to another app. They now have the same colour as the sidebar. The Classic style is unchanged.
- **The panel opens in the style you chose.** The 2025 style used to go on only once the settings had loaded, so for the first seconds you saw the Classic menu and colours and then everything jumped. Each browser now remembers the style and uses it from the start. The first time a browser opens the panel it still starts in Classic until the settings arrive.
- **Health says "loading" until it has something to show.** Opened directly, it showed "Rooms: 0", "Radios: 0" and "Refresh: —ms" as if they were readings. Those lines now say "loading…" until the first answer arrives, and the Scan and Status badges at the top show "…" instead of a dash.
- **Health counts your devices.** "Tags/Objects" read 0 in a house with thousands of devices, because it counted only Home Assistant's own room-tracker entities. It now counts every device PadSpan hears, the same ones the Devices page lists.
- **Atlas no longer says the same thing twice.** While the yellow first-time tip is showing, the line of small print beside the title is hidden. Press "Got it" and the line is back as before.
- **Mapping reads "1 map" or "9 maps"**, not "9 map(s)", and a plan's "updated" time is shown as a date and time in your own time zone instead of a raw timestamp.
- **Mapping's tabs show that there are more.** On a phone the row of tabs was cut off mid-word at the edge of the screen. The edge now fades where more tabs lie beyond it, on either side, so it is clear the row slides.
- **Calibration and Manage tabs on a phone.** When the tabs wrap to a second row, each row now has its own line under it, so the highlighted tab sits on a line instead of floating. On Calibration's Results, "Guided calibration" now sits under the heading on the left when it does not fit beside it.
