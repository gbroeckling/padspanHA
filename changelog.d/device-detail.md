# One name for each device, what it is, and how PadSpan knows

### New
- **One name on every screen.** A device now reads the same everywhere, from the strongest source there is: the name you gave it, the phone's or Home Assistant device's name, the name it broadcasts, then its maker ("Samsung device"), then "Unnamed device". The address sits underneath instead of being the name. A stronger name replaces a weaker one, never the reverse, and a name a device broadcast once stays.
- **What a device is, read from its own broadcast:** Windows PC and the other Microsoft types, AirTag, AirPods or Beats, Find My accessory, Fast Pair accessory, Find Hub tag, Samsung SmartTag, Tile, Eddystone beacon, Xiaomi models, Shelly BLU, RuuviTag, Govee. An iPhone and an iPad send nothing that tells them apart, so they read "Apple phone or tablet".
- **Fixed or Rotating.** A badge says what a receiver reported about the address. Devices, By Room and All objects gather the rotating addresses nobody named by kind ("169 Windows PC addresses"), and older rows fade. Nothing is deleted; click the line to see the rows.
- **The device window says how PadSpan knows:** "Apple, from its company number. AirTag, from its Find My broadcast." Where a company only holds a service number the device uses, it reads "Uses a service from Google" rather than calling it the maker. And a "Copy raw broadcast" button, for a bug report.

### Changed
- **A receiver goes by one name.** The one set on its ESPHome or Shelly device, without the address Home Assistant adds, and Overview's floor labels use it too.
- **"Find My accessory" no longer says "another brand's".** AirPods read that way too: at the house, 83 addresses with that Find My value also send AirPods' pairing message. AirPods are now told by that message.
- **The usage report (opt-in) counts** where the best names come from, how many devices have a type, and how many a receiver says are fixed or rotating. Counts only.

### Fixed
- **PadSpan's own Home Assistant devices no longer read back as a device's "HA device".** A beacon labelled in PadSpan showed "PadSpan HA · BLE Presence Tracker" as its maker and model.
- **Hashes of phone numbers, emails and Apple IDs in Apple's broadcasts are no longer kept.** AirDrop, Hotspot and Nearby Action messages carry them; those bytes are zeroed as an advert arrives, and in what history already holds. Nothing ever read them.
