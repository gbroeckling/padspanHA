# A value of the wrong kind is refused, not a failure

### Fixed
- **A value of the wrong kind no longer ends in "Unknown error".** Sent a number where a list of points belongs, or the like, by a script or an automation calling PadSpan directly (the panel never sends one), a signal wall, an open edge, a WLED team, a room outline and a device's "How we know" answered with Home Assistant's "Unknown error" and an error in its log, and a calibration point with Python's own words. A wall, a team and a calibration point are now refused in words and change nothing; an outline or a device detail of the wrong kind is left out of the answer.
