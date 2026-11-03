# Third-party notices

PadSpan HA bundles the following third-party software, unmodified, under its own licence.

## three.js r170

- Files: `custom_components/padspan_ha/www/padspan-ha/vendor/three/three.module.min.js`
  (the `build/three.module.min.js` of the npm package `three@0.170.0`) and its `LICENSE`.
- Used by: the Live Aboard 3D view, loaded only when that view is switched on.
- Source: https://github.com/mrdoob/three.js

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## xiaomi-ble

- File: `custom_components/padspan_ha/xiaomi_models.py` (product ids, device names and models).
- Adapted from: `DEVICE_TYPES` in https://github.com/Bluetooth-Devices/xiaomi-ble, Apache License 2.0
  (https://www.apache.org/licenses/LICENSE-2.0), to a smaller table: the model suffix `-ENCRYPTED` is dropped.
- Used for: saying what a device is from the product id in its MiBeacon broadcast.

## Facts read from other projects

`custom_components/padspan_ha/device_detail.py` is written for PadSpan and copies no code. The signatures it checks were
read from AirGuard (https://github.com/seemoo-lab/AirGuard, Apache-2.0: Find My's type bits, SmartTag, Tile),
bthome-ble (https://github.com/Bluetooth-Devices/bthome-ble, MIT: Shelly BLU model names) and govee-ble
(https://github.com/Bluetooth-Devices/govee-ble, Apache-2.0: Govee name patterns).

# Third-party data

PadSpan HA bundles tables of numbers and names generated from public registries. No source file, header or other
text from them is included, and they stay under neither of PadSpan's licences beyond what the facts themselves allow.
`tools/build_device_tables.py` regenerates them; a release or a house never asks these registries for anything.

## Bluetooth SIG Assigned Numbers

- Files: `custom_components/padspan_ha/data/bt_companies.tsv` (company identifiers and company names) and
  `custom_components/padspan_ha/data/bt_members.tsv` (member 16-bit UUIDs and the company each is assigned to).
- Generated from: `company_identifiers.yaml` and `member_uuids.yaml` at
  https://bitbucket.org/bluetooth-SIG/public/src/main/assigned_numbers/, with legal forms dropped from the names.
- Used for: naming a device's maker from the company number or service UUID in its own broadcast.

## IEEE Registration Authority

- File: `custom_components/padspan_ha/data/mac_makers.bin` (MA-L, MA-M and MA-S assignments and the organisation
  each is assigned to, without addresses).
- Generated from: https://standards-oui.ieee.org/oui/oui.csv, https://standards-oui.ieee.org/oui28/mam.csv and
  https://standards-oui.ieee.org/oui36/oui36.csv.
- Used for: naming a device's maker from its Bluetooth address, on this machine.
