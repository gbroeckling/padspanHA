# Devices known only by their room sit inside it

### Fixed
- **On the Overview's house map, devices known only by their room now sit inside that room, side by side.** They were all drawn on one point, the average of the room's corners. In an L-shaped room that point is outside the room, and every such device was stacked on it. Now the first sits at a point well inside the room and the next ones step out around it, apart from each other and from devices whose spot is known, the same way Live Aboard places people. Traceback's playback also puts a device known only by its room inside an L-shaped room.
