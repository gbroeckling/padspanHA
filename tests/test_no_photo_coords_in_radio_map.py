"""Scanner positions in the radio map come from the fabric, never from a photo.

A receiver pinned on a floor plan is an input gesture. It is committed to
metres in the fabric, and the fabric is then the only truth about where that
radio is. Reading r.x/r.y back out at render time re-derives a physical
position from a picture, so a trimmed, rotated or re-measured map silently
moves scanners that never moved — the same coupling behind #62.

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
    """The 2D floor heatmap (drawn on a photo) still resolves scanners
    through the fabric helper: one definition plus that call."""
    src = _radio_map()
    assert "fabricWorldScanners" in src, (
        "radio_map.js no longer imports the fabric scanner source"
    )
    assert src.count("_fabricScanners(") >= 2, (
        "the modelled floor heatmap should collect scanners through "
        "_fabricScanners (one definition plus one call)"
    )


def _iso_overlay_bodies(src: str) -> str:
    """Source of the two isometric overlay functions, and only them."""
    a = src.index("export function isoStoreyHeatmapSVG(")
    b = src.index("export function isoStoreyDistortionSVG(")
    end = src.index("\n}\n", b) + 3
    grid = src[src.index("function _storeyModelGrid("):]
    grid = grid[:grid.index("\n}\n") + 3]
    return src[a:end] + grid


def test_iso_overlays_take_a_fabric_storey_not_photos():
    """The isometric heat and warp overlays draw ON the fabric building, so
    they take a STOREY the caller resolved from the fabric — rooms, scanners,
    barriers and calibration points in metres — and nothing about a photo.

    They used to take the photographs grouped at a level plus a per-photo
    pixel transform and sized their grid from the CORNERS OF THE PICTURES.
    When indoor plans stopped carrying that transform the extent was empty
    and both overlays silently drew nothing; a floor with no photograph never
    had one at all.
    """
    src = _radio_map()
    assert "export function isoStoreyHeatmapSVG(storey, iso, liveSnap, settings, range)" in src
    assert "export function isoStoreyDistortionSVG(storey, iso, liveSnap, settings, range)" in src
    assert "export function isoStoreyRssiRange(storey, liveSnap, settings)" in src, (
        "storeys must be able to share one colour scale"
    )
    body = _iso_overlay_bodies(src)
    for photo_word in ("mapPt", "mapTransforms", "groupMaps", "receivers", "x_frac", "map_id"):
        assert photo_word not in body, (
            f"iso overlay reads {photo_word!r}: a photograph is back in the "
            "storey overlays"
        )
    assert "_storeyExtent(storey)" in body, "grid extent must be the storey's rooms"
    for gone in ("modelIsoHeatmapSVG", "isoLevelHeatmapSVG", "isoDistortionSVG(",
                 "computeHeatmapGrid", "isoHeatmapSVG(heatData"):
        assert gone not in src, f"photo-based iso overlay {gone} is back"


def test_the_fabric_source_exists_and_refuses_to_guess():
    """fabricWorldScanners must return null rather than invent a scale."""
    src = _STACK_TRANSFORM.read_text(encoding="utf-8", errors="replace")
    assert "export function fabricWorldScanners(" in src
    body = src[src.index("export function fabricWorldScanners("):]
    body = body[:body.index("\n}\n") + 3]
    assert "worldGauge(" in body, (
        "fabric metres must be converted through the stored world gauge, not "
        "a per-map scale guess and not a scale measured off a photograph"
    )
    assert "return null" in body, (
        "an ungauged fabric must return null so callers render nothing, "
        "rather than falling back to photo coordinates"
    )


def test_no_assumed_map_width_anywhere():
    """World distance becomes metres via the fabric's measured scale.

    radio_map.js carried `const MAP_SCALE_M = 15; // assumed map width in
    meters` and multiplied every modelled distance by it — the same 15 m house
    that loo_accuracy used to fabricate its metre figure from. On any building
    that is not 15 m wide, every predicted RSSI was wrong by the ratio.
    """
    src = _radio_map()
    assert "MAP_SCALE_M" not in src, (
        "an assumed map width is back; convert world distance to metres with "
        "the stored world gauge"
    )
    assert "mPerWorld" in src, "the fabric's measured scale is not being used"


def test_every_live_rssi_model_uses_the_vertical_offset():
    """Pins the LIVE computations, not a helper that might be dead.

    The first version of this guard asserted `sc.dz` appeared somewhere in the
    file. It did — inside _modelRSSI, which had no callers at all, while the
    three real models were inlined in the heatmap loops and ignored dz
    entirely. A guard that can be satisfied by dead code guards nothing, so
    this counts the path-loss lines and requires every one to be 3D.
    """
    src = _radio_map()
    models = re.findall(r"^.*10 ?\* ?pathLossN ?\* ?Math\.log10\(.*$", src, re.M)
    assert models, "no path-loss model found — this test needs rewiring"
    # Each model's distance must be built with the vertical offset.
    dz_sites = re.findall(r"^.*Math\.hypot\(.*sc\.dz.*$", src, re.M)
    assert len(dz_sites) >= len(models), (
        f"{len(models)} live RSSI model(s) but only {len(dz_sites)} use the "
        "scanner's vertical offset — a ceiling scanner directly overhead would "
        "model as zero range"
    )


def test_fabric_scanners_carry_height():
    stack = _STACK_TRANSFORM.read_text(encoding="utf-8", errors="replace")
    assert "abs_z" in stack, "fabricWorldScanners drops the scanner's absolute height"
    assert "m_per_unit" in stack, "fabricWorldScanners drops the world gauge"
