# Mapping's Edit tools and names; plans that fit the window; Sample mode

### Fixed
- **Mapping → Edit: the highlighted tool.** Radios stayed lit on every tool, with its hint. The highlight and the hint now follow the tool you are using.
- **The setup wizard's Set the scale step** opened on the Radios tool though it asks you to measure. It now opens on Measure.
- **Measure** showed the whole Rooms tool above its own panel. It now shows only its own panel.
- **Basic's Edit outline and Place receiver** printed a raw list of coordinates under the one tool. It's gone from Basic. Advanced keeps it.
- **Names on the map in Edit and the Alignment Overlay.** Room and wall names came out stretched and huge, ran into each other, and "metal (12dB)" could be cut at the edge. They're now a small, normal size and stay on the map. Wall names now show only in the Signal walls tool, so they don't hide the plan in the others.
- **Tall floor plans on Pin & Listen, Roam and Model** were as wide as the card, so the floor never fit on screen. They now fit the window's height, except on a very short window such as a phone on its side, where they stay big enough to tap and the page scrolls. Only the size on screen changes: your calibration points, and where a new one lands, are the same.
- **Sample mode → Guests** said guest tags were off while the house showed a guest. It now shows the guest's stay.
- **Sample mode closing what you opened.** A card you opened on the Overview closed again about every 20 seconds.
- **Opening the panel when Home Assistant was slow to answer.** It could say "Mode: SAMPLE" before it knew, and show your own rooms on the sample house, until the next refresh. It now waits to say, and the sample house replaces what was showing, including when it failed to load the first time. A change made in those few seconds waits for the answer: in Live it then goes through, and in Sample it's refused as usual.
