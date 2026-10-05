# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard: lights look like the real lights.

tests/js/live_aboard_lights.mjs runs views/live_aboard_house.js and
views/live_aboard_draft.js for real: the order a light's kind is picked in
(the kind set in Live Aboard, the Atlas shape the person set, its name, a
footprint under 0.4 m never a strip, WLED names, WLED a strip last), strips
as one line on a wall of their room with light on the wall (no glow dots),
pots round a room, a cove, deck pots, a WLED lamp, panel and accent, the
plain point of a light PadSpan is not sure of, a fan's blades, and the 3D
file's kind in the editor's draft. Here: house3d_edit keeps a light's kind
(3D only; the map is never written), checked strictly and kept tolerantly.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as H

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def lights() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_lights.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("kind:", 5), ("strip:", 2), ("ring:", 3), ("wled:", 1), ("fan:", 2), ("draft:", 2),
])
def test_the_lights_harness_covers_each_part(lights, prefix, least) -> None:
    got = {k: v for k, v in lights["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, sorted(lights["cases"])
    bad = [f for f in lights["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_lights_case_passes(lights) -> None:
    assert not lights["failures"], json.dumps(lights["failures"][:4], indent=2, ensure_ascii=False)


# ── house3d_edit: a light's kind ─────────────────────────────────────────────

def test_a_light_can_have_a_kind_with_or_without_a_height():
    out = H.apply_edit(H.empty(), {"lights": {"light.mbr_pots": {"kind": "pot_ring"},
                                              "light.gyver1": {"z_m": 0.75, "kind": "lamp"},
                                              "light.kitchen": {"z_m": 2.1}}})
    assert out["lights"] == {"light.mbr_pots": {"kind": "pot_ring"}, "light.gyver1": {"z_m": 0.75, "kind": "lamp"},
                             "light.kitchen": {"z_m": 2.1}}


def test_a_kind_this_version_does_not_draw_is_still_kept():
    """A newer PadSpan's kind: saved as it is (the view draws its guess)."""
    out = H.apply_edit(H.empty(), {"lights": {"light.a": {"kind": "future_kind_2"}}})
    assert out["lights"]["light.a"] == {"kind": "future_kind_2"}


@pytest.mark.parametrize("entry", [
    {"kind": "Pot Ring"}, {"kind": ""}, {"kind": 5}, {"kind": None}, {"kind": "x" * 41}, {"kind": "pot\n"},
    {"kind": "pot", "colour": "red"}, {}, {"z_m": 1.0, "kind": ["pot"]},
])
def test_a_bad_kind_is_refused(entry):
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"lights": {"light.a": entry}})


def test_the_entry_is_the_editors_whole_and_other_keys_stay():
    """The editor sends a light's whole entry: a height reset keeps the kind
    only if it is sent; None removes both; a newer PadSpan's own keys stay."""
    before = {**H.empty(), "lights": {"light.a": {"z_m": 1.2, "kind": "lamp", "glow": "warm"},
                                      "light.b": {"z_m": 2.0, "kind": "valance"}}}
    out = H.apply_edit(before, {"lights": {"light.a": {"kind": "lamp"}, "light.b": None}})
    assert out["lights"] == {"light.a": {"kind": "lamp", "glow": "warm"}}
    out = H.apply_edit(before, {"lights": {"light.a": {"z_m": 1.5}}})
    assert out["lights"]["light.a"] == {"z_m": 1.5, "glow": "warm"}
    assert before["lights"]["light.a"] == {"z_m": 1.2, "kind": "lamp", "glow": "warm"}, "the file in memory is untouched"


def test_devices_still_take_a_height_alone():
    """A kind is a light's: a sensor's entry is still a height (and a look)."""
    with pytest.raises(H.EditError):
        H.apply_edit(H.empty(), {"devices": {"sensor.t": {"z_m": 1.5, "kind": "lamp"}}})
