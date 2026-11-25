# The usage report says how long one screen shows PadSpan

### Changed
- **The opt-in usage report says how much of the day your busiest screen showed PadSpan.** With the report on, Home Assistant adds up the minutes each screen showed a PadSpan page, and the report says only the busiest single screen's minutes, over the whole day and from 7 am to 11 pm in your Home Assistant's time zone, next to how many minutes the report covers. It never says which screen: each browser's random screen ID stays in your Home Assistant, kept until the report goes (so a restart doesn't lose the count) and then forgotten. Before, the minutes of all your screens were added together, so one wall screen on all day looked the same as three screens on for a third of it. Preview shows it as `top_screen`.
