"""Map image URLs must come through the one helper, and be versioned.

A map's PNG is overwritten in place whenever it is trimmed, rotated or
replaced (MapsStore.async_replace_image writes the same filename), while the
stored width/height change to the new pixel dimensions. So the filename alone
is not a stable identity for the image contents: a URL without a version
query lets the browser serve the CACHED PRE-EDIT picture, which the SVG views
then stretch into the new viewBox with preserveAspectRatio="none".

That is exactly issue #62 — a trimmed floor plan came back as the full
untrimmed blueprint squashed into the trimmed map's shape, with calibration
pins and beacons apparently "off the map". The coordinates were fine; the
picture behind them was stale.

The buster existed in maps.js and was independently re-implemented five more
times there, while calibration.js, overview.js and settings.js built the path
bare and were broken. One helper now owns it (panel.js mapImageUrl); this
test fails the build if a bare path or a hand-rolled copy comes back.

Since 0.38.143 the images are served only to a logged-in user, through a link
the backend signs (map_image_view.py). The version moved with it: it sits
inside the signed link, because anything appended to a signed link breaks
its signature.
"""

from __future__ import annotations

from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
_PANEL = _WWW / "padspan-ha" / "panel.js"
# The old public path, and the new private one: neither is built in the browser.
_MAPS_PATHS = ("/local/padspan_ha/maps/", "/api/padspan_ha/maps/image")


def _js_files() -> list[Path]:
    return [p for p in _WWW.rglob("*.js") if "/lib/" not in p.as_posix()]


def test_only_the_helper_builds_map_image_urls():
    """No view may construct a map image URL from a path."""
    offenders: list[str] = []
    for path in _js_files():
        src = path.read_text(encoding="utf-8", errors="replace")
        for maps_path in _MAPS_PATHS:
            at = src.find(maps_path)
            if at != -1:
                offenders.append(f"{path.name}:{src.count(chr(10), 0, at) + 1}")
    assert not offenders, (
        "map image URL built in the browser — it would be unsigned (so refused) "
        "or unversioned (so stale after a trim); use ctx.helpers.mapImageUrl(map) "
        f"instead: {offenders}"
    )


def test_helper_hands_out_the_signed_link():
    """The helper returns the backend's signed link and builds nothing."""
    src = _PANEL.read_text(encoding="utf-8", errors="replace")
    assert "function mapImageUrl(" in src, "panel.js lost the mapImageUrl helper"
    body = src[src.index("function mapImageUrl("):]
    body = body[:body.index("\n}\n") + 3]
    assert "_mapImageUrls[map.id]" in body
    # The links arrive from maps_list and maps_image_urls, and nothing else sets them.
    assert src.count("_mapImageUrls = ") == 4, "declared once, set by maps_list and by the renewal (in full, or kept per map mid-edit)"
    assert "_mapImageUrls = res.image_urls" in src
    renew = src[src.index("async _renewMapImageUrls("):src.index("async _getMapsList(")]
    assert "padspan_ha/maps_image_urls" in renew and "_mapImageUrls = fresh" in renew
    # A changed picture re-reads the map list, so its size and picture match (issue #62).
    assert "this._getMapsList(false)" in renew


def test_the_backend_versions_the_link():
    """The version (map.updated, else the image sha256) is inside the signed link."""
    from custom_components.padspan_ha.map_image_view import image_path

    m = {"id": "m1", "updated": "2026-01-01T00:00:00",
         "image": {"filename": "m1.png", "sha256": "ab" * 32}}
    assert "?v=" in image_path(m)
    trimmed = dict(m, updated="2026-01-02T00:00:00")
    assert image_path(trimmed) != image_path(m), (
        "an in-place image rewrite must change the link, or the browser shows the stale picture"
    )
    assert "?v=abab" in image_path({"id": "m1", "image": m["image"]}), "no sha256 fallback"


def test_helper_is_exposed_to_views():
    """Views reach the helper through ctx.helpers — it must be wired in."""
    src = _PANEL.read_text(encoding="utf-8", errors="replace")
    helpers = src[src.index("      helpers: {"):]
    assert "mapImageUrl," in helpers[:600], "mapImageUrl is not exposed on ctx.helpers"
