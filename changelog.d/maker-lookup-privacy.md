# Device maker lookup: off by default, maker prefix only

### Changed
- **Looking up who made a device is now off unless you turn it on.** The Objects list can ask two public services (macvendors.com and maclookup.app) which company made each nearby Bluetooth device. Before, that was on by default and sent each device's full address. Now it's off for everyone (updating switches it off once) and you turn it on in **Settings → Presence → Look up device makers online**, or with the switch at the top of the Objects list.
- **When it's on, only the maker part of an address leaves the house** (the first three pairs, such as `AA:BB:CC`), never the full address. Random and group addresses, the kind phones use, are never sent at all: they have no maker, so the list just says "random address". Answers are still kept for 30 days per maker.
- The usage report (opt-in) now says whether this switch is on, as a yes or no only.
