# The panel's files are registered once

### Fixed
- **No "register_static_path is deprecated" line in Home Assistant's log.** On Home Assistant 2024.8 to 2025.7, each time PadSpan reloaded, Home Assistant logged that PadSpan used an old way to serve the panel's files and asked for a bug report. PadSpan registered the same files again on every reload, and the second time fell back to the old call. The files are now registered once each time Home Assistant starts.
