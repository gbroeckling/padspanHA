# PadSpan's own words match what it does

### Fixed
- **The update notice names the right store.** It said "Update via HACS" on Marketplace installs too. It now says the Marketplace, HACS or, for a copy installed by hand, padspan_ha.zip from the release; when it can't tell, it names both stores. It finds out from Home Assistant itself, so it works without the internet.
- **"Room and receiver layout not built yet" says how to build it.** The Overview said the layout builds by itself from the drawn rooms. It doesn't: press Put it on the map on Setup's Finish step, or, in Advanced and Development modes, Commit this layout in Mapping → Layout.
- **A receiver's reliability is a figure to read, not a weight.** Health's help and the room-flapping guide said it is how much PadSpan trusts a receiver. Since 0.38.271 it is only shown: a low one doesn't make that receiver's readings count for less.
- **The Companion app path is Settings → Companion app → Manage sensors.** Training's troubleshooting, the Bluetooth page's Android tip and the Overview's "BLE transmitter is OFF" line left out the Companion app step.
- **Manage → HA Entities → Entity Type Library, the tracker card:** its state is the Home Assistant room name ("Kitchen"), it lists `padspan_id` and `last_room`, and it no longer says GPS trackers and PadSpan merge in a person: a phone's GPS or a router's "home" wins over a room.
- **Sub-zones are drawn with the Sub-zones tool in Mapping → Edit,** as Manage → HA Entities now says.
- **Installing by hand:** README and Getting started say to unzip `padspan_ha.zip` into `custom_components/padspan_ha`. The zip has no folder of its own.
- **The guest tags guide lists what the `padspan_ha_guest` event sends:** `session` too, `room` only for arrived, left and off_limits, and `how` for ended.
- **The bug report form** lists the receivers PadSpan reads (ESPHome Bluetooth proxy, Shelly, Home Assistant's own Bluetooth adapter, ESPresense, Tasmota), asks about Bermuda on its own, and shows current example versions.
