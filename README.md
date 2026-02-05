# PadSpan (prototype)

PadSpan is a **Home Assistant Bluetooth (BLE) integration assistant** focused on being **easier, more reliable, and more user-friendly** than “power user” BLE tracking setups.

This repository is a **prototype** packaged as a **custom integration** for quick testing on **Home Assistant OS**.

## What’s in this ZIP (v0.0.1)
### Included now (testable)
- Custom integration: `custom_components/padspan`
- Config flow (UI install via **Settings → Devices & Services → Add Integration → PadSpan**)
- BLE advertisement ingest via Home Assistant’s Bluetooth stack (no pairing/connecting)
- Basic entities:
  - `sensor.padspan_seen_devices` — number of unique BLE advertisers seen since startup
  - `sensor.padspan_last_advertisement` — last advertiser summary (address hidden by default; available in attributes)
  - `sensor.padspan_discovery_candidates` — top candidates during a “walk-to-identify” session (prototype)
- Services:
  - `padspan.start_discovery_session` — start a discovery walk session (collects candidates)
  - `padspan.stop_discovery_session` — stop session and freeze candidates
  - `padspan.clear_seen_devices` — clear in-memory seen set

### Documentation & roadmap
- Full product synopsis + plans: **docs/PROJECT_SYNOPSIS.md**

## Install (Home Assistant OS)
1) Copy the folder `custom_components/padspan/` into:
   - `/config/custom_components/padspan/`
2) Restart Home Assistant.
3) Go to **Settings → Devices & Services → Add Integration → PadSpan**
4) Enable **Bluetooth** in HA if it isn’t already (Settings → Devices & Services → Bluetooth).

> Tip: If you use ESPHome Bluetooth proxies, they’ll feed data into HA’s Bluetooth stack automatically.

## Notes
- This prototype is intentionally conservative: it listens to **BLE advertisements only** (low power, low friction).
- No map UI is included yet; the roadmap outlines the planned UI (likely as a Lovelace custom card / panel).

## License
Apache-2.0 (see LICENSE)

