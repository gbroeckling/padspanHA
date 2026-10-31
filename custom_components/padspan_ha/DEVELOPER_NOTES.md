# PadSpan HA — Developer Notes (v0.4.14)

These notes are for future debugging sessions with ChatGPT / collaborators.

## What changed in v0.4.14

### 1) "All Objects" inventory + "Unidentified" list
- The Overview page now treats every metric as an entry point to a **list modal**.
- Buttons:
  - **All objects**
  - **Unidentified**
  - **Bluetooth radios**
  - **Rooms list**

The Objects modal shows a union of:
- **Entity objects** (Bermuda tags / device_trackers / etc. from the room map)
- **BLE objects** (unique BLE addresses deduped from HA Bluetooth advertisement monitor)

It includes:
- Filter box + kind/status dropdowns
- OUI frequency badge (≥3) — this is the "device type shows up more than twice" heuristic.
- Best-effort vendor lookup (online) with caching.

### 2) BLE snapshot is now included in `padspan_ha/live_snapshot`
`custom_components/padspan_ha/websocket.py` now injects:

- `snapshot.ble.radios`
- `snapshot.ble.advertisements`

This uses `BluetoothLive` (`custom_components/padspan_ha/bluetooth_live.py`) which subscribes to HA Bluetooth changes.

### 3) Vendor lookup endpoint + caching
WebSocket command:
- `padspan_ha/vendor_lookup` `{"mac": "AA:BB:CC:DD:EE:FF"}`

Backend:
- `custom_components/padspan_ha/vendor_lookup.py`

Providers (two independent sources):
1) MACVendors API (vendor string)
2) MACLookup v2 (JSON: company + flags like isRand/isPrivate)

Cache:
- stored by **OUI prefix** (`AA:BB:CC`) in HA storage (`Store`)
- TTL: 30 days
- rate-limited to avoid API spam

Settings:
- `vendor_lookup_enabled` is stored in `settings_store.py` (default: True). Only an administrator can change it (`ws_settings.py`): Settings → Tracking → Privacy, updates and feedback → "Look up device makers online", or the switch at the top of the Objects list.

What is sent (the rule, word for word everywhere): It sends only the first three bytes of an address, and only after a Bluetooth receiver has confirmed that the device has a fixed, maker-assigned address (ESPHome proxies on version 2022.12 or newer and Home Assistant's own Bluetooth say so, and PadSpan remembers it; Shelly, ESPresense and Tasmota don't, so a device only they have heard isn't looked up).
- An allowlist. Only an address a radio CONFIRMED as public is sent: ESPHome `BLEDevice.details["address_type"]` 0 from firmware 2022.12 or newer, BlueZ `props["AddressType"]` "public" (`bluetooth_live.address_type_of()`; ESPHome 1-3 and BlueZ "random" are random). Random or unknown is never sent, whatever the bits; `lookup_skip_reason()`'s bit rule (0x02 locally administered, 0x01 multicast) only holds back more.
- `known_address_type()` gives `ws_vendor_lookup` the answer: "random" if any radio said so (the per-address record `_address_types`, the records, the scanners' own caches via `async_scanner_devices_by_address`, since HA's own adapter's live adverts carry no type while BlueZ's cache has it), else "public" if one confirmed it, else None. On any error, None.
- Confirmed public addresses are kept in `.storage` (`PUBLIC_ADDRESSES_STORE_KEY`, `BluetoothLive._public`, at most `PUBLIC_MAX`, oldest confirmed first out), through prunes and restarts: a public address never changes type. A "random" report removes one. "Random" is kept in memory only, while the address is cached; nothing needs it after that, since unknown is never sent.
- ESPHome's 0 is also protobuf's empty value: firmware before 2022.12.0 (esphome#4115) sends no address type, and every address it hears arrives as 0. `address_type_of(device, esphome_ok)` counts a 0 as public only when `BluetoothLive._esphome_public_ok(source)` says that proxy's firmware sends the type (`esphome_version()`: bleak-esphome's scanner connector, `connector.client.keywords["client_data"].device_info`, or HA's ESPHome config entry `runtime_data.device_info`; `esphome_sends_address_type()`); an unknown version counts as no type. 0.38.211 trusted every 0, so its file (no `"rule": PUBLIC_STORE_RULE`) is not read.
- A removal (a "random" report) is saved at once (`Store.async_save`), not with the 60 s delayed save, so a power cut can't bring it back. Factory Reset clears `_public` and removes the file through the live store (cancelling a pending save), and the vendor cache with it.
- Not confirmed ("unconfirmed": Shelly, ESPresense and Tasmota never report a type): the answer already kept for the prefix, if there is one, and nothing is sent; the panel says "maker unknown (receiver doesn't say)". 0.38.207-0.38.210 let the bits decide for an address of unknown type, and could send the first three bytes of a random one in edge cases (0.38.210's 5-minute rule is gone).
- The panel (overview.js) asks about each address itself and keeps no answers. Rows whose bits mark them random, and private BLE rows, say "random address" without asking.

## Where to debug

### "Unidentified count is 0, but HA shows many ads"
- Confirm HA Bluetooth is enabled + you have scanners/proxies running.
- Check `snapshot.ble.advertisements` in the WS response for `padspan_ha/live_snapshot`.

### "Vendor lookup doesn't work / always Unknown"
- Confirm outbound internet access for HA instance.
- Look at HA logs (we log debug-level failures).
- MACVendors returns 404 for unknown OUIs; that's expected.
- MACLookup may return `found=false`.

### "Radios list shows the wrong devices"
- Radios are now taken from `snapshot.ble.radios` (not Bermuda / tag entities).

## Frontend pointers
- `www/panel.js` — adds modal helpers + `vendorLookup()` action
- `www/views/overview.js` — Overview cards + list modals
