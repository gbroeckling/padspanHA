# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""No save that writes nothing.

fabric_spatial_batch_save went in 0.30 (fa6c7f26) and its frontend calls were
cut out of the code around them, which left empty `try {}` blocks and loops
whose only statement had been the save, some under comments or messages that
still said the data was saved. These are the ones that were tidied; each check
fails if the empty shape comes back.
"""

from __future__ import annotations

import re
from pathlib import Path

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _read(name: str) -> str:
    return (_VIEWS / name).read_text(encoding="utf-8")


def test_no_empty_try_in_panel_views():
    for f in sorted(_VIEWS.glob("*.js")):
        assert not re.search(r"\btry\s*\{\s*\}", f.read_text(encoding="utf-8")), f.name


def test_maps_rotate_has_no_dead_remap():
    src = _read("maps.js")
    assert "_rotPoint" not in src
    assert "if(newReceivers.length || Object.keys(newBounds).length || newBeacons.length){" not in src
    # The server still gets the rotation, which is what turns the pins/trace.
    assert "pixel_op: { deg: _rotAngle, sx: 1, sy: 1 }" in src


def test_calibration_claims_no_save_it_does_not_make():
    src = _read("calibration.js")
    assert "Save cleaned maps immediately so removal persists" not in src
    assert "so duplicates are permanently cleaned" not in src
    assert "// Auto-save the deletion" not in src
    # The real writes are still there.
    assert 'ctx.actions.radioResetQuiet(src)' in src
    assert src.count('type: "padspan_ha/fabric_beacon_remove"') >= 3
