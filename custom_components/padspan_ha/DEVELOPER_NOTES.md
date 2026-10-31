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
- `vendor_lookup_enabled` is stored in `settings_store.py` (default: True). Only an administrator can change it (`ws_settings.py`).

What is sent: first three bytes only; never addresses known to be random or locally administered.
- The provider URLs carry the prefix (`AA:BB:CC`), never the whole address.
- `bluetooth_live.address_type_of()` records "public"/"random" when the radio reports it (ESPHome proxies: `BLEDevice.details["address_type"]`, 0/1; BlueZ: `props["AddressType"]`). `known_address_type()` gives `ws_vendor_lookup` the answer; "random" is never sent.
- When no radio reported the type, `lookup_skip_reason()` falls back to the first byte's bits: 0x02 (locally administered) or 0x01 (multicast) are never sent.

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
