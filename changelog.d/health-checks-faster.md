# Health checks answer faster

### Fixed
- **The Health and Q&A checks no longer hold up Home Assistant for seconds.** Layout checks, the propagation grade and the system critics each worked out the calibration accuracy from scratch, comparing every calibration point with every other, and Home Assistant waited while they did: over a second each with a few hundred points, every 30 seconds while the page was open. That work is now about half as long, and done once until a calibration point changes.
