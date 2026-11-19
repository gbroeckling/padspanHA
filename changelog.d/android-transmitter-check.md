# Android phones: a warning when the transmitter is set too weak

### New
- **Track Your Phone warns when an Android phone sends too weakly.** Out of the box the Home Assistant Companion app sends at its lowest power, in its power-saving mode, and receivers barely hear it. When a phone's BLE Transmitter is on Ultra low or Low power, or in Low power advertise mode, its row on the Overview now says so and what to set: Transmit power to High and Advertise mode to Low latency (Companion app → Settings → Companion app → Manage sensors → BLE Transmitter).

### Fixed
- **The Bluetooth screen no longer tells Android owners to look for a key.** It said the Companion app's BLE Transmitter holds an IRK; it doesn't, and an Android phone needs none, as the phone wizard already said. The IRK forms and their help now say the key is for iPhones and Apple Watches.
- **The phone guide** on padspan.traks.ca (English and German) no longer says to leave the transmitter's settings as they are.
