# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Working, proven beacons on the Mapping → Lights map — read only.

Garry, 2026-09-09: "add working proven beacons to the mapping, lights
section under devices. For now have them look the same as they do in
overview." Followed up with "keep it basic as per your recommend" — this is
deliberately NOT a port of Overview's own beacon subsystem (away/present
states, trails, outside-tethering, persistent pins, room-centroid staggering
for position-less objects): just a dot and a name, for whatever the server
already has a real position for. "Working, proven" mirrors the exact test
Overview's own map already applies to a beacon — `o.user_label || o.identified`
(views/overview.js) — and "No placement for them of course" means genuinely
read-only: no click handler, no Map-column entry, nothing in gatherLights at
all (see tests/test_lights_renderer.py for the render-side pass this data
feeds — pointer-events="none", opts.beacons — this file is the maps.js side
that decides what counts as "working, proven" in the first place).

Source-level pin, not a rendered-DOM test: `beacons` is computed directly
from ctx.state.live.snapshot, which _lightsTab has no test harness that can
supply short of the full render_smoke fixture — see
tests/test_door_window_barriers.py's `_lights_tab_block()` for the same
tradeoff on other _lightsTab host fields.
"""

from __future__ import annotations

from pathlib import Path

_MAPS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
         / "www" / "padspan-ha" / "views" / "maps.js")


def _lights_tab_block() -> str:
    src = _MAPS.read_text(encoding="utf-8", errors="replace")
    block = src[src.index("function _lightsTab(ctx, maps, active) {"):]
    return block[:block.index("\nfunction ", 1)]


def _beacons_block() -> str:
    block = _lights_tab_block()
    idx = block.index("const beacons = (ctx.state.live")
    return block[idx: block.index("\n\n", idx)]


def test_beacons_come_from_the_live_snapshots_objects_list():
    block = _beacons_block()
    assert "ctx.state.live?.snapshot?.objects?.list" in block, block


def test_only_ble_kind_objects_are_admitted():
    block = _beacons_block()
    assert '(o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon")' in block, block


def test_working_proven_means_labelled_or_identified():
    """The exact test views/overview.js's own map already applies to a
    beacon — not raw unidentified BLE noise."""
    block = _beacons_block()
    assert "(o.user_label || o.identified)" in block, block


def test_stale_and_ghost_objects_are_excluded():
    block = _beacons_block()
    assert "!o._stale && !o._ghost" in block, block


def test_position_check_uses_typeof_not_number_coercion():
    """Number(null) is 0 — a real coordinate. The filter must use typeof, or
    every position-less object in the house would draw at world (0,0)
    instead of being excluded (the exact bug this file's own render-side
    test in test_lights_renderer.py caught on the first pass)."""
    block = _beacons_block()
    assert 'typeof o.x_m === "number" && Number.isFinite(o.x_m)' in block, block
    assert 'typeof o.y_m === "number" && Number.isFinite(o.y_m)' in block, block


def test_no_room_centroid_fallback_the_way_overview_has_one():
    """A basic v1 draws only what the server truly knows — Overview's own
    room-centroid stagger for a position-less object is explicitly NOT
    ported here."""
    block = _beacons_block()
    assert "roomIsoPos" not in block, "no room-centroid fallback in the basic version"


def test_host_object_carries_the_computed_beacons_list():
    block = _lights_tab_block()
    # The literal property shorthand `beacons,` inside the host object
    # literal — not a re-derivation, the SAME list computed once above.
    host_idx = block.index("const host = {")
    host_snippet = block[host_idx: host_idx + 400]
    assert "beacons," in host_snippet, host_snippet
