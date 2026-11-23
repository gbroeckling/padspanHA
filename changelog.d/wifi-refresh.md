# Wi-Fi coverage keeps itself up to date

### Fixed
- **Wi-Fi coverage (test) updates by itself.** It loaded its readings once and then stayed as it was until a button was pressed; it now asks UniFi Blocker again each minute while it is open, and waits while a picker is open.
- **Both bands have their button from the start.** 2.4 and 5 GHz are always there, so 5 GHz no longer seems to be missing before the first phone reading; the screen opens on a floor that has readings in the band it shows.
- **The access point picker is as wide as its names**, not the whole screen.
