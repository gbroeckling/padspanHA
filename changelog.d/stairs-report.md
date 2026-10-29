# Stairs in the usage report, and split levels that stay put

### Fixed
- **A raised or sunken room no longer moves again when Live Aboard redraws.** Since 0.38.190, any redraw (after an edit in Furnish, for example) applied the raise a second time, so a room raised 0.75 m was drawn 1.5 m up until the page was reloaded.

### Changed
- **Usage report (if you share it): how stairs are used, and whether they work.** Each time Live Aboard draws a house with stairs: whether every flight lands in a room on the level it reaches, or one lands in no room, or one has no floor above to reach (the same check as Furnish's warnings); whether one reaches a raised or sunken room or is a few steps within a floor; and which shapes and styles are used. The daily report also says how many stairs were imported or came from a stair room's guess, and their shapes and styles. Never where they are or which.
