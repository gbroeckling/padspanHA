# Three more saved files are set aside, not written over

### Fixed
- **The object history and the opt-in report's two files are kept when PadSpan cannot read them.** Since the last release a PadSpan file in `.storage` that holds the wrong kind of data is renamed to `<name>.unreadable.<date>` and named once in Home Assistant's log, instead of being started empty and written over. Three files still missed that: the object history (`padspan_ha.object_history`, the devices PadSpan remembers after they go quiet), and the opt-in report's run log and usage counts (`padspan_ha.perf_runs`, `padspan_ha.telemetry_counters`). They are now set aside and named the same way.
