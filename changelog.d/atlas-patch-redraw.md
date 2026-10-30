# The Atlas redraws only what changed

### Changed
- **The sidebar Atlas no longer redraws the whole map every 5 seconds.** Each update now keeps the floors, rooms, walls and labels it already drew and replaces only the parts that changed: a light switched, motion, a new reading. Switching floors, changing the spacing or zoom, a setting, or a new map still redraws it whole. The map looks exactly as before. It does a little less work on every update, which helps most on a large wall screen. Moving rings no longer jump back to the start of their cycle on every update.
