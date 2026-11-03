# One name for each device, what it is, and how PadSpan knows

### New
- **One name on every screen.** A device now reads the same everywhere, from the strongest source there is: the name you gave it, the phone's or Home Assistant device's name, the name it broadcasts, then its maker ("Samsung device"), then "Unnamed device". The address sits underneath instead of being the name, and where you pick a device (Follow, Calibration, Presence, Monitor, Locate, a room's window) a name that is only a maker or a service gets the end of its address: "Apple device · 8A:3B:63". A stronger name replaces a weaker one, never the reverse, and a name a device broadcast once stays.
- **What a device is, read from its own broadcast:** Windows PC and the other Microsoft types, AirTag, AirPods or Beats, Find My accessory, Fast Pair accessory, Find Hub tag, Samsung SmartTag, Tile, Eddystone beacon, Xiaomi models, Shelly and Shelly BLU, RuuviTag, Govee. Apple's broadcasts mostly don't say whether they come from an iPhone, an iPad, a Mac or a Watch, so those read "Apple device".
- **Fixed or Rotating.** A badge says what a receiver reported about the address. Devices, By Room and All objects gather the rotating addresses nobody named by kind ("169 Windows PC addresses"), and older rows fade. Nothing is deleted; click the line to see the rows, or search: a search opens a group it matches. Devices shows at most 300 lines at once and says how many more an open group holds.
- **The device window says how PadSpan knows:** "Apple, from its company number. AirTag, from its Find My broadcast." Where a company only holds a service number the device uses, it reads "Uses a service from Google" rather than calling it the maker. And a "Copy raw broadcast" button, for a bug report; it hides any IRK and gives only the name the device broadcast, never your label.

### Changed
- **A receiver goes by one name on screen.** The one set on its ESPHome or Shelly device, without the address Home Assistant adds: Overview's floor labels, Calibration's Tune and Beacon Tune, QA and Health. What calibration already saved under a receiver stays as it was saved.
- **"Find My accessory" no longer says "another brand's".** AirPods read that way too: at the house, 83 addresses with that Find My value also send AirPods' pairing message. AirPods are now told by that message.
- **Apple is no longer named as the maker of HomeKit accessories and that Find My value without AirPods' message.** They use Apple's company number whoever made them, as iBeacons do, so they read as what they are, with no maker. Calibration's beacon groups don't change.
- **Forensics' CSV has two new columns at the end,** `best_name` and `what_it_is`, with PadSpan's name and what it worked out. `name` and `device_type` stay what the device sent, for anyone reading a file.
- **The usage report (opt-in) counts** where the best names come from, how many devices have a type, and how many a receiver says are fixed or rotating. Counts only.

### Fixed
- **PadSpan's own Home Assistant devices no longer read back as a device's "HA device".** A beacon labelled in PadSpan showed "PadSpan HA · BLE Presence Tracker" as its maker and model.
- **Hashes of phone numbers, emails and Apple IDs in Apple's broadcasts are no longer kept.** AirDrop, Hotspot and Nearby Action messages carry them; those bytes are zeroed as an advert arrives, and in what history already holds, a message cut short included. Nothing ever read them.
