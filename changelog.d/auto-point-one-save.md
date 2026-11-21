# One write per automatic calibration point

### Fixed
- **A pinned beacon's automatic calibration points write the calibration file once each, not twice.** Each point was saved, and then trimming the beacon's oldest point (50 are kept) saved the whole file again: about 1,400 writes a day of a several-megabyte file in a busy house, wearing an SD card for nothing. The trim now goes in the same save; the points kept are the same.
