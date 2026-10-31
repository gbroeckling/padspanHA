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

What is sent: first three bytes only; never addresses known to be random or locally administered.
- The provider URLs carry the prefix (`AA:BB:CC`), never the whole address.
- `bluetooth_live.address_type_of()` reads "public"/"random" when the radio reports it (ESPHome proxies: `BLEDevice.details["address_type"]`, 0 public, 1-3 random; BlueZ: `props["AddressType"]`). HA's mgmt channel and Shelly scanners don't report it.
- The type is kept per address (`BluetoothLive._address_types`), not per report: HA's own adapter's live adverts carry none (habluetooth's mgmt side channel) while the reseed reads BlueZ's, and in 0.38.207 each live advert wiped the reseed's "random". A report with no type keeps the earlier one, "random" is never downgraded, and the entry goes only when the address leaves the cache (age prune, cap, `clear_scanner`, factory reset).
- `known_address_type()` gives `ws_vendor_lookup` the answer: that record, and, until it says "random", the scanners' own caches (`async_scanner_devices_by_address`), for an address first heard on HA's adapter before the next reseed. "random" is never sent.
- When no radio reported the type, `lookup_skip_reason()` falls back to the first byte's bits: 0x02 (locally administered) or 0x01 (multicast) are never sent.
- The panel (overview.js) asks about each address itself and keeps no answers: kept by prefix, a random address showed the maker of another device sharing its first three bytes. Rows whose bits mark them random, and private BLE rows, say "random address" without asking.

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
