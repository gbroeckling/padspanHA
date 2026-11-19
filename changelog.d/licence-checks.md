# Licence and update checks, done more carefully

### Changed
- **The licence check no longer puts your key or Home Assistant's instance ID in a web address.** Both now go in the body of the request, and in place of the instance ID PadSpan sends a one-way hash of it. A licence server that doesn't read the hash yet is asked once more the way earlier versions ask, so nothing stops working in between.
- **The daily checks wait a random while after Home Assistant starts** (5 minutes to 6 hours), and a restart within 20 hours of the last check doesn't check again. Homes that restart together after a Home Assistant release no longer all ask at the same moment.
- **PadSpan's requests say they come from PadSpan** (its own User-Agent instead of Home Assistant's default), and a server that answers "too many requests" is asked once more after the wait it names (at most a minute).

### Fixed
- **Home Assistants whose instance ID can't be read are no longer all one home.** Each sent the same stand-in to the licence server, so every such install counted as the same home on a key. Each now has its own random ID, made once and kept in PadSpan's settings (a Factory Reset keeps it).
