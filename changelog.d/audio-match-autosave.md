# Audio: the volume counts as Control4 does; matches are kept as you pick them

### Fixed
- **− and + on an Audio player no longer count in tens.** A Control4 room moves 1 step in 100 a press, but the card showed a guessed level 10 higher or lower straight away, and drawing that guess again under your finger could lose the next quick press. A player that steps itself (Control4 and the other whole-house systems) now shows only the level it reports, so every press lands. A player Home Assistant steps for it (one that can only be set to a level) still shows its next level at once.
- **The Audio matching card keeps every pick as you make it.** A room picked, ▲ or ▼, or Include Home Assistant speakers is saved at once, and the card's own guesses are kept as it opens, so nothing is lost by closing it. Save and Cancel are gone: **Done** closes the card, and a line beside it says Saved (or Not saved, with the reason, if Home Assistant refused).
