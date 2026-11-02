# Live Aboard on a wall: sharp, and as large as the screen lets it be

### Changed
- **A wall draws Live Aboard at every pixel of its screen.** On Auto or High, a wall (`?kiosk=1`) used to stop at about 1440p's worth, and on Auto fell to Low if its graphics chip couldn't turn the house at 30 frames a second. Now it draws High at the screen's full resolution. If the chip can't turn the house smoothly at that size, the picture is softer only while the camera moves, and sharp again as soon as it stops. A 1080p wall on a small Intel PC used to fall to Low on Auto; it now stays on High, sharp when still and turning at 30 frames a second. A chip too slow for that (a 4K screen on the same PC) draws about 1440p's worth, as it did, and on Auto goes to Low if that is still too slow. **Low** chosen in Settings stays Low.
- **Live Aboard fills a wall's screen.** The whole house used to be framed clear of the bars along the top and bottom, even though they fade when nobody is there, and with a margin for a perspective it never quite filled. It now fills the screen, keeping clear only of the chips along the top, and turns about the house's middle. Framed that closely, turning or tilting it by hand can run part of the house past the edge; **Fit** or going home brings it back. A real house on a 16:9 wall came out about a third larger. Only walls change; every other screen frames the house as before.

- **A wall hides Home Assistant's sidebar.** With `?kiosk=1` the map now has the whole screen. Home Assistant's own sidebar is hidden on that browser only, the same switch as **Hide HA**. **Show HA** on the Atlas page (without `?kiosk=1`) brings it back.
- Counts how a wall screen ended up drawing (`house3d_wall_draw`: every pixel, every pixel but less while moving, about 1440p's worth, or Low), once per page load, only with the usage report on.

### Fixed
- **A wall turned by its link (`&wall_rotate=90` or `270`) used the whole screen.** The map was only as tall as the screen was before turning, leaving a large empty band beside it.
