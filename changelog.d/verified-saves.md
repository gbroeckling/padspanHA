# Saves are checked against the disk

### Changed
- **Less work after each save.** After a save, PadSpan used to read the whole file back and unpack it. With a large calibration file, which is saved about once a minute while beacons calibrate themselves, that held Home Assistant up for a moment each time. The check below reads the file without unpacking it.

### Fixed
- **A save that did not reach the disk is no longer called saved.** After saving its rooms, maps, settings, calibration or Live Aboard file, PadSpan read the file back but only checked that something was there. When Home Assistant could not write the file (a full or read-only disk), the old file was still there, so the save passed. PadSpan now checks that the file holds exactly what Home Assistant wrote. A save that did not land is written to the log and shown as a notice under Settings, Repairs; the notice goes away by itself when a save works again. The check only reads: it never changes, deletes or puts back a file.
