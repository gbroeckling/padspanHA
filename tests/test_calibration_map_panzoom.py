# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Pan/zoom parity across Calibration's two phone-based map tabs, and the
real bug found while adding it to the second one.

Garry, 2026-09-10: "do 2-10" (from a missing-features shortlist) — #7 was
"Pin & Listen already got pan/zoom (best-in-class gap #11); Roam, its
sibling tab, never did." While wiring Roam up to match, found live that
Pin & Listen's own map was INVISIBLE (~4px tall) — mapInner is
position:absolute, so its real content-driven height never propagates up to
mapWrap, which collapses to ~0px under overflow:hidden with no other in-flow
content. Fixed both by tying mapWrap's own box to the same aspect ratio the
SVG's own viewBox already uses.

Source-level pin, not a rendered-DOM test: pan_zoom.js's own header notes
this is "pointer/keyboard-event-driven DOM interaction with no real layout
geometry under the project's dom_shim.mjs" — the shim does no real CSS box
layout, so a getBoundingClientRect()-based assertion cannot be written here;
verified live instead (both tabs, screenshot + getBoundingClientRect() in a
real browser) before this file was added.
"""

from __future__ import annotations

from pathlib import Path

_CAL = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
        / "www" / "padspan-ha" / "views" / "calibration.js")


def _src() -> str:
    return _CAL.read_text(encoding="utf-8")


def _fn_block(name: str) -> str:
    src = _src()
    start = src.index(f"function {name}(")
    nxt = src.index("\nfunction ", start + 1)
    return src[start:nxt]


def test_pin_and_listen_calls_attach_pan_zoom():
    assert "attachPanZoom(mapWrap, mapInner)" in _fn_block("_pinAndListen")


def test_roam_now_calls_attach_pan_zoom_too():
    assert "attachPanZoom(mapWrap, mapInner)" in _fn_block("_roam")


def test_both_tabs_tie_the_wrapper_to_the_svgs_own_aspect_ratio():
    """The actual fix for the invisible-map bug: without this, mapWrap (a
    position:relative box with only an absolutely-positioned child) has no
    in-flow content and collapses to ~0px height under overflow:hidden."""
    for name in ("_pinAndListen", "_roam"):
        block = _fn_block(name)
        assert "mapWrap.style.aspectRatio = `100 / ${vbH}`;" in block, (
            f"{name} does not tie mapWrap's box to the SVG's own aspect ratio")


def test_roams_map_structure_matches_pin_and_listens():
    """Same wrap/inner shape attachPanZoom requires: viewport (position:
    relative) + inner (position:absolute, transform-origin 0 0)."""
    roam = _fn_block("_roam")
    assert 'const mapWrap = el("div", { style: "position:relative;' in roam
    assert 'const mapInner = el("div", { style: "position:absolute;top:0;left:0;width:100%;transform-origin:0 0" });' in roam
