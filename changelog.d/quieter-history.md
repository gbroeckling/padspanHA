# A lighter Home Assistant database

### Changed
- **Signal readings are no longer stored in Home Assistant's history.** Every few seconds each tracked device's area sensor, distance sensors and tracker got a new signal strength, "seconds since heard" and confidence, and Home Assistant stored all of them each time. Those values are still shown on the entity, live, and automations can still use them; they are just not saved to the history database any more. The room, home or away, and the device's name are still saved, so history still shows where everything was. The occupancy sensor's per-room evidence and how sure it is are left out the same way.
