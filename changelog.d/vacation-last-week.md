# Vacation Mode replays last week

### Changed
- **Vacation Mode now replays last week by default.** Each day plays like the same day last week: a Tuesday turns lights on and off the way they went last Tuesday, half hour by half hour, with a little variation each night so it isn't the same to the minute. If that day falls inside an earlier vacation or has no history, it uses the same weekday a week earlier, then the monthly average. The intensity slider still scales it.
- **A "Monthly average" choice.** In Vacation Mode's Options, "Routine from" has two buttons: Last week, or Monthly average (each weekday from the last month's average, the way Vacation Mode worked before). The choice is used when Vacation Mode is turned on. A trip that's already running keeps its routine, and a change applies the next time you turn it on.
- **Evening lights follow when they were really on, not sunset.** Each evening light stays on over the stretch it was actually on that evening: last week's same day, or the usual start and end time for that weekday on the monthly average. A light that wasn't on that evening isn't held. Bedtime still turns them off, and they no longer need Home Assistant's sun times. "Only after dark" is unchanged.
- The preview says which routine it plays ("From last week" or "From the monthly average"). `binary_sensor.padspan_vacation_mode` has a new `source` attribute.

### Opt-in report
- The Vacation Mode section says which choice is set: `last_week` or `month`. Nothing else changed.
