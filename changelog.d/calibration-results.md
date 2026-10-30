# Calibration opens on its results

### Changed
- **Calibration opens on a new Results tab.** It answers the two questions people come with: how accurate is it, and how do I make it better.
  - **How accurate it is now:** rooms right and the typical distance off, tested on spots it hasn't seen (the same score Model and QA show), with how many calibration points you have. Before that score has run, the older estimate is shown and said to be an estimate.
  - **Room by room:** the rooms that need work come first (no points yet, the ones most often mixed up with another room, the ones with only a few points). Rooms that look fine fold away under one line.
  - **The next best thing to do:** one step, with a button that goes to the right place. In order: give a floor plan a real-world scale, start calibrating, set receiver heights, set floor heights, work the accuracy out again after new points, add points in a room with none, add points in the weakest room, or walk the house again when the newest point is over 90 days old. With nothing to fix, it points to Accuracy by spot.
  - **Guided calibration** is the main button. Leaving the guide brings you back to Results.
- A new house with no calibration points sees two lines about what calibration does and the Guided calibration button.
- In Sample mode, Results shows the sample house's made-up results. Nothing on Results saves or changes anything; calibration points are only read.
- Every other tab is still there, with the same name, in the tab bar. A tab you pick is kept while the page stays open. Links like `?view=calibration&tab=tune` open that tab, and the Overview's receiver-heights tip and Mapping's "Go to Calibration" open their tabs even when Calibration hadn't been opened yet.

### Opt-in report
- With the usage report on: how often Calibration's Results tab is opened, and which of its buttons is used (the kind of step, such as "set receiver heights" or "Guided calibration"; never a room). Not counted in Sample mode.
