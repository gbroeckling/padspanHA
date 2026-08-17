# Architecture

## Folder map

- `custom_components/padspan_ha/`
  - `manifest.json` (HA metadata; domain MUST match folder name)
  - `__init__.py` (setup entry)
  - `config_flow.py` (initial config UI)
  - `options_flow.py` or options handler (gear icon)
  - `coordinator.py` (runtime state)
  - `settings_store.py` (persistent UI settings)
  - `map_store.py` (maps + receivers + calibration)
  - `websocket.py` (WS API registration + re-exports), `ws_*.py` (handlers by subject), `snapshot_builder.py` (the live snapshot), `ws_common.py` (shared helpers)
  - `panel.py` (register single panel entry)
  - `diagnostics.py` (optional, HA diagnostics)
  - `strings.json` + `translations/*.json` (labels)
  - `icon.png` + `logo.png` (HA uses these in Integrations UI)

- `custom_components/padspan_ha/www/padspan-ha/`
  - `panel.js` (panel entrypoint)
  - `styles.css` (panel styling)
  - `views/*.js` (each view renderer: overview, objects, maps, etc.)
  - `assets/` (branding images)

- `docs/` (this logic set)

## Setup lifecycle

1) HA imports the integration module.
2) HA reads `manifest.json` to learn:
   - `domain`
   - `config_flow`
   - version
3) `async_setup_entry` runs:
   - create coordinator
   - initialize stores
   - register websockets
   - register panel
4) User opens sidebar entry:
   - HA loads `panel.js`
   - `panel.js` renders nav + views
5) UI calls WS:
   - backend returns data
   - UI re-renders

## Why we use websockets for UI

- HA already uses websockets heavily for frontend ↔ backend communication.
- `hass.callWS` is stable across versions.
- This avoids writing custom HTTP APIs and the auth/cors edge cases.

