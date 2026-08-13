"""Scanner positions in the radio map come from the fabric, never from a photo.

A receiver pinned on a floor plan is an input gesture. It is committed to
metres in the fabric, and the fabric is then the only truth about where that
radio is. Reading r.x/r.y back out at render time re-derives a physical
position from a picture, so a trimmed, rotated or re-measured map silently
moves scanners that never moved — the same coupling behind #61.

radio_map.js modelled three heatmaps that way (modelIsoHeatmapSVG,
modelFloorHeatmapSVG, isoDistortionSVG), each iterating m.receivers and
projecting through the per-map pixel transform. They now take their scanners
from stack_transform.fabricWorldScanners, which also carries z_m, so the model
can use a real slant range instead of assuming every radio sits on the floor.

There is deliberately no photo fallback: when the fabric cannot place scanners
(empty, or maps never measured so there is no metre anchor) the heatmap renders
nothing, because an unmeasured photo has no scale to fall back to.
"""

from __future__ import annotations

import re
from pathlib import Path

_VIEWS = (
    Path(__file__).resolve().parents[1]
    / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
)
_RADIO_MAP = _VIEWS / "radio_map.js"
_STACK_TRANSFORM = _VIEWS / "stack_transform.js"


def _radio_map() -> str:
    return _RADIO_MAP.read_text(encoding="utf-8", errors="replace")


def test_no_receiver_pin_positions_are_read_for_scanners():
    """The exact pattern that shipped three times must not come back."""
    src = _radio_map()
    hits = re.findall(r"for \(const r of \(m\.receivers", src)
    assert not hits, (
        f"{len(hits)} scanner collection loop(s) read receiver pin positions off "
        "a map again — use _fabricScanners() so a re-measured or trimmed photo "
        "cannot move a scanner that did not move"
    )


def test_no_pixel_transform_is_applied_to_a_receiver():
    """mapPt(r.x, r.y) converts a picture coordinate into a physical one."""
    src = _radio_map()
    bad = re.findall(r"(?:mapPt|mpt)\(\s*r\.x", src)
    assert not bad, (
        "a receiver pin is being projected through the per-map pixel transform; "
        "scanner positions must come from the fabric in metres"
    )


def test_the_fabric_helper_is_the_source():
    src = _radio_map()
    assert "fabricWorldScanners" in src, (
        "radio_map.js no longer imports the fabric scanner source"
    )
    assert src.count("_fabricScanners(") >= 4, (
        "every modelled heatmap should collect scanners through _fabricScanners "
        "(one definition plus one call per heatmap)"
    )


def test_the_fabric_source_exists_and_refuses_to_guess():
    """fabricWorldScanners must return null rather than invent a scale."""
    src = _STACK_TRANSFORM.read_text(encoding="utf-8", errors="replace")
    assert "export function fabricWorldScanners(" in src
    body = src[src.index("export function fabricWorldScanners("):]
    body = body[:body.index("\n}\n") + 3]
    assert "metreAnchor(" in body, (
        "fabric metres must be converted through the measured anchor, not a "
        "per-map scale guess"
    )
    assert "return null" in body, (
        "an unanchored fabric must return null so callers render nothing, "
        "rather than falling back to photo coordinates"
    )


def test_scanner_height_reaches_the_model():
    """The fabric carries z, so the heatmap must do real 3D range."""
    stack = _STACK_TRANSFORM.read_text(encoding="utf-8", errors="replace")
    assert "abs_z" in stack, "fabricWorldScanners drops the scanner's absolute height"
    src = _radio_map()
    assert "sc.dz" in src, (
        "_modelRSSI ignores the vertical offset again — a ceiling scanner "
        "directly overhead would model as zero range"
    )
