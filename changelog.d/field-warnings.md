# Fewer warnings in the Home Assistant log

### Fixed
- **Reloading PadSpan no longer logs "Panel re-registration failed".** Saving PadSpan's options or pressing Reload tried to add the sidebar panel a second time, which Home Assistant refuses. PadSpan now takes its own panel down first, so the panel is refreshed and the log stays quiet.
- **The phone search in Track Your Phone no longer fails because of one phone.** A phone whose BLE Transmitter reported a Major or Minor that was not a number stopped the whole search, so no phone was listed. That phone is now listed like the others.
- **A calibration point refused on a map with no metre scale is no longer a log warning.** The Calibration tab already tells you why and what to do (measure the map first); the log only repeated it on every try. Other save failures still show in the log.
- **A device key that already belongs to another device is no longer a log warning.** PadSpan still refuses to merge the two devices, as before; it just doesn't warn about doing its job.
