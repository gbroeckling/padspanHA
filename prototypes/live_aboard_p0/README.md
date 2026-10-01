# Live Aboard P0 prototype

The P0 step in `docs/IDEA_ATLAS_3D_HOUSE.md`: a standalone page that draws a real house in 3D
from PadSpan's map, with cut-away walls, the lights, and two furniture builders (sofa, bed).
It is a prototype to try on the wall PC and a phone. It is not part of PadSpan HA and is never
shipped; nothing here is loaded by the integration.

Written clean-room, as the plan requires: no ported application code, three.js as a library only.

## Running it

1. Put a `house_export.json` next to `index.html`. It holds `{"model": …, "light_states": …}`,
   where `model` is the result of `padspan_ha/model_get` (the page reads `floors`, `room_meta`,
   `room_geometry_m`, `light_positions_m`, `rf_barriers_m` and `floor_elevations`) and
   `light_states` maps each light's entity id to `state`, `name`, `rgb_color`, `brightness`,
   `color_temp_kelvin` and `device_class`.
   The file describes a real home, so `.gitignore` keeps it out of the repo.
2. Serve the folder: `python -m http.server 8000`, then open http://127.0.0.1:8000/.
   three.js r170 loads from jsDelivr.

Tapping a light switches it on the page only; nothing is sent to Home Assistant.

`verify_p0.py` drives the page headless with Playwright at 1920×1080 and 390×844 and writes
`shot_*.png` (also ignored).
