"""Map image URLs must be built through the versioned helper.

A map's PNG is overwritten in place whenever it is trimmed, rotated or
replaced (MapsStore.async_replace_image writes the same filename), while the
stored width/height change to the new pixel dimensions. So the filename alone
is not a stable identity for the image contents: a URL without a version
query lets the browser serve the CACHED PRE-EDIT picture, which the SVG views
then stretch into the new viewBox with preserveAspectRatio="none".

That is exactly issue #61 — a trimmed floor plan came back as the full
untrimmed blueprint squashed into the trimmed map's shape, with calibration
pins and beacons apparently "off the map". The coordinates were fine; the
picture behind them was stale.

The buster existed in maps.js and was independently re-implemented five more
times there, while calibration.js, overview.js and settings.js built the path
bare and were broken. One helper now owns it (panel.js mapImageUrl); this
test fails the build if a bare path or a hand-rolled copy comes back.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
_PANEL = _WWW / "padspan-ha" / "panel.js"
_MAPS_PATH = "/local/padspan_ha/maps/"


def _js_files() -> list[Path]:
    return [p for p in _WWW.rglob("*.js") if "/lib/" not in p.as_posix()]


def test_only_the_helper_builds_map_image_urls():
    """No view may construct a map image URL from the raw path."""
    offenders: list[str] = []
    for path in _js_files():
        if path == _PANEL:
            continue
        src = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(re.escape(_MAPS_PATH), src):
            # Prose mentioning the serve path is fine; building a URL is not.
            window = src[m.end():m.end() + 60]
            if "filename" in window or "${" in window:
                line = src.count("\n", 0, m.start()) + 1
                offenders.append(f"{path.name}:{line}")
    assert not offenders, (
        "map image URL built without the cache-busting version — a trimmed or "
        "rotated map will render as its stale pre-edit image; use "
        f"ctx.helpers.mapImageUrl(map) instead: {offenders}"
    )


def test_helper_versions_the_url():
    """The helper itself must append a version derived from the map."""
    src = _PANEL.read_text(encoding="utf-8", errors="replace")
    assert "function mapImageUrl(" in src, "panel.js lost the mapImageUrl helper"
    body = src[src.index("function mapImageUrl("):]
    body = body[:body.index("\n}\n") + 3]
    assert "?v=" in body, "mapImageUrl no longer cache-busts the URL"
    assert "updated" in body and "sha256" in body, (
        "mapImageUrl must version on map.updated (falling back to the image "
        "sha256), or an in-place image rewrite goes unnoticed by the browser"
    )


def test_helper_is_exposed_to_views():
    """Views reach the helper through ctx.helpers — it must be wired in."""
    src = _PANEL.read_text(encoding="utf-8", errors="replace")
    helpers = src[src.index("      helpers: {"):]
    assert "mapImageUrl," in helpers[:600], "mapImageUrl is not exposed on ctx.helpers"
