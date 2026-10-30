# The Atlas keeps its map card between updates

### Changed
- **The sidebar Atlas keeps its map card between updates.** Each update used to build the map's card again whole: its controls, floor chips, legend and the stage with the rain, people and Live Aboard on it. Now the card stays on screen and only what changed is redrawn: the floor and type chips when their counts change, and the parts of the map that changed. An update takes about 45% less time at 1080p and on a 4K wall. Changing a setting, the floor, the spacing, the layout or the map still builds the card fresh, as before. The rain is no longer set up again on every update.
- **Whole house's "Yes, change the whole house" goes back to Apply after 10 seconds.** The next update used to reset it; now that the card stays, a timer does, so a confirm is never left waiting on a wall screen for a stray tap. The same for "Yes, turn on Vacation Mode".
