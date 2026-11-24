# The robot vacuum's card, and room location runs

### New
- **The robot vacuum has its own card.** With a Valetudo robot linked, press and hold the robot on the Atlas or in the 3D house to open it. It talks to the robot's own Valetudo (no vacuum entity or MQTT needed): what the robot is doing, its battery, and Start, Pause and Dock. If Valetudo's login is on, the card asks for its user and password and says so plainly when the robot answers 401. For administrators; a tap on the robot still shows its small card.
- **Room location runs (optional, off until you start one).** Stick a fixed-address Bluetooth beacon (iBeacon or Eddystone, not an AirTag or a Tile) on top of the robot, and the card's Room location part sends the robot to spots about 1.5 m apart in every room (or just one), clear of the walls. At each spot it stands still for about 20 seconds while PadSpan listens to the beacon, and the spot is added to calibration. Calibration is backed up before every run, Stop sends the robot back to its dock, and Undo this run takes out exactly the points that run added, never your own. The card shows what is missing first: the robot's address, its map from Valetudo, and whether the beacon is heard right now.

- **Find mistakes.** A button on the robot's card opens a card of its own that lists receivers placed in the wrong spot or on the wrong floor, worked out from the points the runs already collected (no extra driving): which receiver, where it is placed, where the readings put it, how sure, and a link to its placement. Receivers heard at too few spots are listed as not enough readings. Nothing is moved.
- **The robot's Wi-Fi at each spot.** During a run the robot also reports its Wi-Fi signal at each spot; PadSpan keeps the last 2,000 for the Wi-Fi coverage map, and other integrations can read them. A spot where the Wi-Fi can't be read is not skipped.

### Changed
- **The robot is always on the map while its link is on.** With Robot Vacuum Import on, the robot is drawn on the Atlas and in the 3D house whether people and tags are shown or not, so its card is always one hold away.
- **The robot's points are PadSpan's, not yours.** In every count that tells your own calibration points from automatic ones, the robot's points count as automatic. The beacons' own clean-ups never remove them; only a run's Undo does.
