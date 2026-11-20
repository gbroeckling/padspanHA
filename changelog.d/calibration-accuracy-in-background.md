# Calibration accuracy worked out in the background

### Fixed
- **Opening Health or the calibration model no longer freezes Home Assistant while the accuracy is worked out.** The calibration accuracy compares every calibration point with every other; with a few hundred points that takes seconds, and Home Assistant could do nothing else meanwhile (no automations, no other integrations, a frozen dashboard). It is now worked out in the background, as Home Assistant does with its own slow jobs.
