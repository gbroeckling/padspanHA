# Errors PadSpan handles quietly are counted

### New
- **Diagnostics lists the errors PadSpan handled quietly.** When one part of PadSpan fails, the rest carries on, and until now nothing said so. Each such place in the code now counts how often it happens and keeps the last error, in memory only, since Home Assistant started. An administrator sees them in Diagnostics (QA → Go to Diagnostics) under "Errors PadSpan handled quietly": where, how many times, the last error and when. The list is not part of the report you send to support, and nothing is written to the log or to disk.

### Changed
- **The opt-in usage report carries those counts.** For up to 20 of those places it sends the place's fixed name from the code and a number, so the ones that really happen in people's houses can be found and fixed. It never sends an error's text. The README's list of what the report sends says so.
