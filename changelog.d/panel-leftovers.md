# The occupancy sensor's real name

### Fixed
- **Manage → HA Entities gave the wrong ID for the occupancy sensor.** It said `sensor.padspan_occupancy`. Home Assistant names it `sensor.padspan_occupancy_occupancy`, so use that in your automations unless you've renamed it. The sensor itself hasn't changed.
