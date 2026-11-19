"""The Mapping -> Lights preset bundle, pinned at the source level.

The owner (2026-09-10): "we now have thousands of combinations in the mapping,
lights setup, we need to build a preset system." Then (2026-09-12): "include
more elements into this feature" — the Floor / Spacing / L-R layout joined
the bundle, under the SAME overview_iso_* keys Save view already writes, so
applying a preset stays one plain settingsSet call. The sanitizer's own
behaviour (clamps, optional layout keys) is covered in
test_ws_settings_normalizers.py; these tests pin the two frontends against
it — a key the sanitizer accepts but a surface never saves or applies is a
silent no-op, not an error, so nothing else would catch it.
"""

from __future__ import annotations

from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_MAPS = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
_SIDEBAR = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
_LAYOUT_KEYS = ("overview_iso_floor_gap", "overview_iso_horiz_gap", "overview_iso_focus")


def _block(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i)]


def test_the_builder_saves_the_layout_trio_into_a_preset():
    save = _block(_MAPS, "onSavePreset: async (name) =>", "onDeletePreset:")
    for k in _LAYOUT_KEYS:
        assert k in save, f"Save current must capture {k}"
    # From the live slider state, the same source Save view reads — not the
    # settings echo, which lags its own round-trip.
    assert "overview_iso_floor_gap: view.floorGap" in save
    assert "overview_iso_horiz_gap: view.horizGap" in save
    assert "overview_iso_focus:     view.focusIdx" in save


def test_the_builder_applies_the_layout_trio_only_when_the_preset_carries_it():
    apply = _block(_MAPS, "onApplyPreset: async (values) =>", "onSavePreset:")
    assert "view.floorGap = values.overview_iso_floor_gap" in apply
    assert "view.horizGap = values.overview_iso_horiz_gap" in apply
    assert "view.focusIdx = values.overview_iso_focus" in apply
    # Optional: an older look must not move the camera.
    for k in _LAYOUT_KEYS:
        assert f"values.{k} !== undefined" in apply, f"{k} must be applied only when present"


def test_the_sidebar_applies_the_layout_trio_the_same_way():
    apply = _block(_SIDEBAR, "onApplyPreset: async (values) =>", "this._render();")
    assert "this._view.floorGap = values.overview_iso_floor_gap" in apply
    assert "this._view.horizGap = values.overview_iso_horiz_gap" in apply
    assert "this._view.focusIdx = values.overview_iso_focus" in apply
    for k in _LAYOUT_KEYS:
        assert f"values.{k} !== undefined" in apply, f"{k} must be applied only when present"
