# Walk a room on by default; a notification for leak, smoke, gas and CO alarms

### New
- **A leak, smoke, gas or CO alarm sends a notification.** When one latches, PadSpan sends one notification ("PadSpan: Leak alarm", with the sensor, its room and the time), and one when it clears: reset in the Atlas, or the 2 days over. Nothing more while it stays latched, however often the sensor goes off again. It goes to the phones and email addresses your Follow alerts send to; with none set, to the first notify service Home Assistant has (a mail one first), as a Follow alert with no target does; with no notify service at all, nothing is sent. On by default: Settings → Atlas → Atlas — Mapped Light Control → "Notify when a leak, smoke, gas or CO alarm goes off".

### Changed
- **Walk a room is on by default, and Setup offers it first.** Setup's Calibrate step now starts with the 90-second walk per room, with "Point by point" beside it for Guided calibration. A new install has it on. An install from before is switched on once by this update, unless a walk was saved there: then it was on and someone turned it off, and it stays off. Turn it off or on again in Settings → Tracking → Positioning and calibration → Walk a Room (Calibration).
