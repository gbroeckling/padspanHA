# Third-party notices

PadSpan HA bundles the following third-party software under its own licence, unmodified unless said otherwise.

## Adaptive Lighting (adapted)

- Files: `custom_components/padspan_ha/adaptive_curve.py`: the sun-position curve and the brightness and
  colour-temperature rules, adapted from its file color_and_brightness.py
  (`SunEvents.sun_position`, `SunLightSettings._brightness_pct_default` and `.color_temp_kelvin`). Changed: rewritten as
  plain functions over sunrise and sunset timestamps, the night's colour always fades to the sleep colour, brightness
  and colour only.
- Used by: power teams (a wall dimmer and the smart bulbs it feeds), whose bulbs follow the day.
- Source: https://github.com/basnijholt/adaptive-lighting, Copyright Bas Nijholt and contributors.
- Licence: Apache License, Version 2.0, https://www.apache.org/licenses/LICENSE-2.0

## PDF.js 6.5.438

- Files: `custom_components/padspan_ha/www/padspan-ha/vendor/pdfjs/`, from the npm package `pdfjs-dist@6.5.438`:
  - `pdf.min.js` and `pdf.worker.min.js`: its legacy build (`legacy/build/pdf.min.mjs` and
    `pdf.worker.min.mjs`, renamed to `.js` so Home Assistant serves them as JavaScript), and its `LICENSE`.
  - `wasm/`: the image decoders for black-and-white scans (JBIG2, CCITT) and JPEG 2000, with their
    JavaScript fallbacks, the colour-profile module, and their licences (`LICENSE_*`). The JavaScript
    engine for PDF forms (quickjs) is not included.
  - `standard_fonts/`: the Foxit and Liberation fonts PDF.js draws unembedded standard fonts with,
    with `LICENSE_FOXIT` and `LICENSE_LIBERATION`.
- Used by: Mapping → Upload, to turn one page of a PDF floor plan into a picture in the browser.
  Loaded only when a PDF is picked.
- Source: https://github.com/mozilla/pdf.js
- Licences: PDF.js, Apache License 2.0 (`vendor/pdfjs/LICENSE`). The decoders and fonts carry their own
  licences in the files named above: BSD (PDFium JBIG2, OpenJPEG), MIT (qcms), the Foxit font licence
  and GPL-2.0 with a font exception (Liberation Sans, Red Hat).

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
`tools/build_device_tables.py` in the padspanHA repository regenerates them; a release or a house never asks these registries for anything.

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
