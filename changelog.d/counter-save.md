# The usage report's day counts are saved again

### Fixed
- **The usage report's day counts are saved, and Home Assistant no longer warns about PadSpan.** Since 0.38.177 the counts were meant to be saved every two minutes so a restart doesn't lose them. The save ran in a background thread, where Home Assistant refuses it, so nothing was saved and the log said "padspan_ha calls hass.async_create_task from a thread other than the event loop". It now runs where Home Assistant expects. A count made from a background thread is handed over the same way, and a test checks that everything PadSpan schedules runs there.
