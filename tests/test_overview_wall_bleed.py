# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Overview walls draw on their OWN storey only.

`_storeyOf` keeps every wall within 2 storeys because radio_map.js needs the
walls between a device and a scanner on another floor for its attenuation
math. The draw loop used to paint all of them at the current storey's height:
the upstairs walls across the main floor and vice versa (Garry, 2026-09-09:
"some of the walls are OK, maybe a floor to floor bleed?"). Scanners already
had the `floorDist !== 0` draw-time filter; walls now carry floorDist and use
the same one. These pin both halves in the source, the way the repo's other
overview guards do.
"""

from __future__ import annotations

import re
from pathlib import Path

_OVERVIEW = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
             / "www" / "padspan-ha" / "views" / "overview.js").read_text(encoding="utf-8")


def _storey_of() -> str:
    a = _OVERVIEW.index("const _storeyOf = (z) => {")
    b = _OVERVIEW.index("return { z, rooms, scanners, barriers, calPoints: calPts };", a)
    return _OVERVIEW[a:b]


def _walls_draw_loop() -> str:
    a = _OVERVIEW.index("if(ctx.state._overviewShowWalls){")
    b = _OVERVIEW.index("// Scanners ON this storey", a)
    return _OVERVIEW[a:b]


def test_walls_are_still_collected_within_two_storeys_for_the_rf_model():
    body = _storey_of()
    bar = body[body.index("const barriers = [];"):]
    assert "const floorDist = Math.abs(_fabF.rankOf(bz) - rank);" in bar
    assert "if (floorDist > 2) continue;" in bar, "radio_map.js needs the neighbouring storeys' walls"
    assert re.search(r"barriers\.push\(\{[^}]*\bfloorDist\b", bar), "each wall must carry floorDist to the draw loop"


def test_the_draw_loop_paints_only_this_storeys_own_walls():
    loop = _walls_draw_loop()
    assert "for(const bar of storey.barriers){" in loop
    assert "if(bar.floorDist !== 0) continue;" in loop, "walls from other storeys are being drawn on this one"
    # The filter must come BEFORE anything is projected or emitted.
    assert loop.index("if(bar.floorDist !== 0) continue;") < loop.index("iso(p[0], p[1], z)")


def test_scanners_and_walls_use_the_same_draw_time_rule():
    """One rule for both: collected wide for the model, drawn narrow."""
    assert "if(sc.floorDist !== 0) continue;" in _OVERVIEW
    assert "if(bar.floorDist !== 0) continue;" in _OVERVIEW
