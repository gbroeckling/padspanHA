# PadSpan HA (Custom Integration)

PadSpan is a Home Assistant custom integration that listens to Bluetooth advertisements via Home Assistant's
Bluetooth stack and exposes live diagnostics sensors (rolling packets and unique devices).

## Install (manual)
1. Copy `custom_components/padspan` into `/config/custom_components/padspan`
2. Restart Home Assistant
3. Settings → Devices & Services → Add Integration → **PadSpan**

## Install (HACS custom repository)
1. HACS → Integrations → ⋮ → Custom repositories
2. Add your repo URL and category **Integration**
3. Install and restart Home Assistant

## Entities
- Packets last 60s
- Unique devices last 60s
- Packets last 5m
- Unique devices last 5m
- Packets today
- Unique devices today
- Last seen
