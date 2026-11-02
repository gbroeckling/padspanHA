# It no longer rains on the Atlas because of a rain sensor that has gone quiet

### Fixed
- **A rain sensor that has stopped reporting no longer makes it rain.** A sensor that goes silent while wet stays on, and it can stay that way for days, so rain kept falling on the Atlas and in Live Aboard under a dry sky. If the sensor's device has a Last seen sensor and it's more than 3 hours old, PadSpan now treats the rain sensor as having no reading and goes by the weather entity. A sensor with no Last seen works as before.
- **Settings tells you.** Under the rain sensor it now says "This sensor hasn't reported since" and the date, and that it's using the weather forecast instead. The opt-in usage report counts it (`weather_note:sensor_stale`): a name only, never which sensor.
