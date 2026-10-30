# Stopping a calibration capture early

### Fixed
- **Stop & Discard during a calibration capture no longer causes a hidden error.** Pressing it while PadSpan was fetching the next reading let the capture carry on into readings it had just thrown away. A Stop then a quick Start could also leave the old capture running alongside the new one, doubling its samples. Pin & Listen, Roam and Guided calibration all share this fix.
