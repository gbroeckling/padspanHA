"""Active vs passive scanning is a THIRD fact, and the other two look like it.

A radio has three independent properties that all sound like "is it on":

    scanning     the scanner is running at all
    connectable  it can open GATT connections to devices
    scan_mode    ACTIVE (transmits SCAN_REQ, reads the SCAN_RSP that comes
                 back) or PASSIVE (listens only)

Only the third says whether the radio transmits. They are routinely confused —
`bluetooth_live.py` itself carried a comment reading "BOTH ACTIVE (connectable
scanners) and PASSIVE (non-connectable)", which conflates two of them, and on
2026-08-25 that comment was taken at face value while wiring the map marker
that shows scan mode.

It was measured on the real install before shipping: of 18 radios, 17 reported
`scan_mode="passive"` with `requested_scan_mode="auto"`, and 16 of those had
`connectable=True`. Keying the marker off `connectable` would have painted
almost every radio as transmitting while not one of them was.

So these tests pin the distinction itself, not just the plumbing.
"""
from __future__ import annotations

import enum
import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


class _Mode(enum.Enum):
    """Stand-in for habluetooth.BluetoothScanningMode."""
    PASSIVE = "passive"
    ACTIVE = "active"
    AUTO = "auto"


class _Scanner:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


@pytest.fixture(scope="module")
def scanning_mode():
    from custom_components.padspan_ha.bluetooth_live import _scanning_mode
    return _scanning_mode


def test_enum_becomes_its_plain_value(scanning_mode) -> None:
    s = _Scanner(current_mode=_Mode.ACTIVE, requested_mode=_Mode.AUTO)
    assert scanning_mode(s, "current_mode") == "active"
    assert scanning_mode(s, "requested_mode") == "auto"


def test_passive_is_reported_as_passive(scanning_mode) -> None:
    assert scanning_mode(_Scanner(current_mode=_Mode.PASSIVE), "current_mode") == "passive"


def test_unknown_stays_none_and_is_never_guessed(scanning_mode) -> None:
    """Not transmitting and not telling us are different facts. An older
    habluetooth has no such attribute at all; that must read as unknown, never
    as passive — a UI that draws unknown as passive is asserting something it
    was never told."""
    assert scanning_mode(_Scanner(), "current_mode") is None
    assert scanning_mode(_Scanner(current_mode=None), "current_mode") is None


def test_auto_is_preserved_as_its_own_value(scanning_mode) -> None:
    """AUTO is not a synonym for either. It starts the scanner passive and lets
    the manager promote it to active on demand, which is why `current_mode`
    genuinely changes over time on a live install — every radio on the
    maintainer's own house reports requested=auto, current=passive, flipping to
    active only inside an active window."""
    assert scanning_mode(_Scanner(current_mode=_Mode.AUTO), "current_mode") == "auto"


def test_a_non_enum_mode_still_degrades_to_a_string(scanning_mode) -> None:
    """Defensive: habluetooth could hand back something else. Anything
    unrecognised must still be a lowercase string or None — never a crash in
    the snapshot path, which runs on every poll."""
    class _Plain:
        def __str__(self): return "BluetoothScanningMode.ACTIVE"
    assert scanning_mode(_Scanner(current_mode=_Plain()), "current_mode") == "active"


# ── the frontend must key off the right one ─────────────────────────────────

@pytest.mark.parametrize("view", ["views/overview.js", "views/plan_viewer.js"])
def test_the_map_marker_uses_scan_mode_not_connectable(view: str) -> None:
    """Both renderers draw the same radio marker: two rings and a centre dot.
    The inner ring turns red when the radio is ACTIVELY scanning.

    The failure this guards is silent and plausible-looking — the marker still
    renders, it is just wrong about every radio. So the check is on which fact
    the decision reads.
    """
    src = (_WWW / view).read_text(encoding="utf-8")
    m = re.search(r"const rxActive = ([^;]+);", src)
    assert m, f"{view} no longer derives rxActive — did the marker change?"
    expr = m.group(1)
    assert "scan_mode" in expr, (
        f"{view}: the active-radio ring is not keyed on scan_mode: {expr!r}")
    assert "connectable" not in expr, (
        f"{view}: the active-radio ring reads `connectable`, which means 'can open "
        f"GATT connections', NOT 'transmits scan requests': {expr!r}. On the "
        "maintainer's own install 16 of 18 passive radios are connectable, so this "
        "would light nearly every radio red while none is transmitting.")
    assert '=== "active"' in expr or "=== 'active'" in expr, (
        f"{view}: rxActive must require an exact \"active\", so that \"auto\" and a "
        f"missing value are not treated as transmitting: {expr!r}")


@pytest.mark.parametrize("view", ["views/overview.js", "views/plan_viewer.js"])
def test_only_the_active_marker_carries_the_animation(view: str) -> None:
    """The blink is a declarative SVG <animate>, matching follow.js and
    iso_lights.js. A passive or unknown radio must emit the markup it always
    did — no animation node, nothing for the browser to run. Every radio on a
    normal install is passive, so the common path has to stay free."""
    src = (_WWW / view).read_text(encoding="utf-8")
    block = re.search(r"s \+= rxActive\s*\?(.+?);\n", src, re.S)
    assert block, f"{view}: the active/inactive ring branch is gone"
    active_arm, _, passive_arm = block.group(1).partition(": `")
    assert "<animate" in active_arm, f"{view}: the active ring no longer blinks"
    assert "<animate" not in passive_arm, (
        f"{view}: a non-active radio emits an <animate> node — every radio on a "
        "normal install is passive, so this would animate the whole map")
