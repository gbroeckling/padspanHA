# The device maker lookup sends the first three bytes only

### Changed
- **The maker lookup no longer sends whole Bluetooth addresses.** Opening the Objects list asks macvendors.com and maclookup.app which company made each nearby device. It now sends the first three bytes of an address only (such as `AA:BB:CC`), never the whole address, and never an address known to be random or locally administered, the kind phones use. When a Bluetooth proxy reports an address as random (ESPHome proxies and BlueZ do), it is never sent; when the type isn't reported, the address's own bits decide. The list says "random address" for those.
- **Only an administrator can turn it off or on:** Settings → Tracking → Privacy, updates and feedback → Look up device makers online, or the switch at the top of the Objects list. It stays on by default, so nothing changes for anyone who uses it, except what is sent.
- With the lookup off, every Bluetooth row in the Objects list says so.
- The usage report (opt-in) says whether the lookup is on, as a yes or no only.
