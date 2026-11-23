# A fairer accuracy score

### Fixed
- **Calibration's "How accurate it is now" counts only what it can test.** Four changes to how the score is worked out:
  - A room calibrated at one spot only is listed as not counted. It used to count as wrong, because the test holds out the spot and its neighbours and nothing of that room was left.
  - A spot's true room is the room drawn where it stands, not a label that disagrees with it. How many disagree is shown.
  - Spots heard by a single receiver are left out, as live tracking leaves them out.
  - In a big calibration, each room is tested in proportion to its spots.
  On a real house the score went from 4 % to 29 % rooms right for fingerprints, and from 12 % to 28 % for spatial, on the same data.
  Nothing about how positions are worked out changed. If you turned on "pick the better method", the comparison it makes now uses this fairer score. The opt-in report counts how many rooms couldn't be tested (a number, never a name).
