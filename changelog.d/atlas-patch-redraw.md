# The Atlas redraws only what changed

### Changed
- **The sidebar Atlas no longer redraws the whole map every 5 seconds.** Each update now keeps the floors, rooms, walls and labels it already drew and replaces only the parts that changed: a light switched, motion, a new reading. Switching floors, changing the spacing or zoom, a setting, or a new map still redraws it whole. The drawing is the same as a full redraw would make. It does a little less work on every update, which helps most on a large wall screen. The fading rings around recent motion now keep pulsing smoothly instead of starting over at every update.
