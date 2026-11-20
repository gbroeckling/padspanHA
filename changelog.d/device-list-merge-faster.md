# Device list builds faster next to a street

### Fixed
- **Building the device list no longer slows down with the square of the passing crowd.** When many passing devices are taken for one rotating device (all those that say nothing and are heard by the same receivers, or send the same kind of Apple message), each one merged in re-read and re-sorted the whole list of addresses gathered so far. Hundreds of them took a large share of every build, and Home Assistant waits while the list is built. They are now gathered once per group; the list is the same.
