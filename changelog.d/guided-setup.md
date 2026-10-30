# One guided Setup

### New
- **Setup, one step after another.** Setting up a house is now one list in order: upload a floor plan, set its scale, give the floors their heights, draw the rooms, place the receivers and say how high each is, then calibrate. Each step says whether it's done, next, still to do or skipped, and opens the tool that already does it (the Mapping Setup Wizard at that step, Mapping → 3D Stack's Floor Heights, or the guided calibration). A bar over that tool shows which step you're on and leads back to Setup.
- **Skip a step and come back later.** Setup remembers the step you were on and the ones you skipped, so it picks up where you left off, on any screen. Whether a step is done comes from your house itself: a plan uploaded, a distance measured, a floor given a height (a one-floor house has nothing to set), a room drawn, receivers placed and not all at one height in a house of two floors or more, and five calibration points or a computed model.
- **Where to find it.** "Open Setup" on the Overview's Getting started card, a Setup button beside Refresh on Mapping, and "Make it a map" on a new install's Who's where. With no floor plan yet, Mapping's "Start Setup Wizard" is Setup's first step: the same wizard, with the bar back to Setup (and no second Setup button above it). The Getting started steps still go straight to their tool, now with the bar back to Setup. The Mapping Setup Wizard and Guided calibration are still where they were, and Mapping's and Calibration's tabs are unchanged.
- **Setup is about your own house.** While the demo house is showing (Sample mode), Setup says so, its step buttons wait for your own house, and nothing is stored or counted.

### Changed
- **Getting started's "Calibrate" means calibrated.** It used to tick as soon as receivers were placed in the layout, which is its own step (Place Scanners). Now it needs five calibration points or a computed model, the same as Setup's Calibrate step. A house whose Getting started was already finished or skipped doesn't see the card again.

### Opt-in report
- **How far people get through Setup:** each step reached, each step skipped, and Setup finished (once per install, and only for a house that used it). Counts only, by step name, so the developer can see where people stop.
