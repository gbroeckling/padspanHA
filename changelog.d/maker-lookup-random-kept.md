# The maker lookup never sends a known random address

### Fixed
- **0.38.207 could still send the first three bytes of some random addresses** to macvendors.com and maclookup.app, for up to 30 seconds after an advert from Home Assistant's own Bluetooth adapter (up to 60 if the Bluetooth refresh interval was raised). Those adverts don't say whether an address is random, and each one wiped what BlueZ had said until PadSpan read it again. This version fixes it: once a radio has said an address is random, PadSpan keeps that for as long as it keeps the address, and for an address it has no type for yet, it asks the radios before anything is sent. Whole addresses were never sent.
- **The Objects list shows each address's own maker.** It kept answers by their first three bytes, so a random address could show the maker of another device with the same first three bytes (nothing was sent for it). A random address now always says "random address", and so does a private BLE row.
- **With the lookup off, every Bluetooth row says "Lookup off"**, iBeacon and private BLE rows included.
