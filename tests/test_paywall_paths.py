"""A licence gate must always answer "then what?".

Until 2026-08-24 none of them did. The light-placement refusal said "Light
placement needs PadSpan Bright Pro or PadSpan Pro" with no price and no link;
the Lights tab pointed at "Settings → PadSpan Pro", a surface that does not
exist; and the ONLY licence-key field in the entire panel was a `prompt()`
inside the Forensics toggle, so someone who bought Pro to place lights had to
enable an unrelated recording feature to activate their key.

The invariant these tests hold: every user-facing refusal names both where to
put a key and where to get one, and both come from one definition.
"""
from __future__ import annotations

import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _CC / "www" / "padspan-ha" / "views"

BUY_URL = "https://padspan.traks.ca/#pro"
# The canonical path, as editions.js defines it (with the arrow as an escape).
LICENCE_PATH_BITS = ("Settings", "Features", "PadSpan licence")


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def test_editions_owns_the_purchase_constants() -> None:
    """One definition, so a gate cannot drift from the page that sells the key."""
    s = _read(_VIEWS / "editions.js")
    for name in ("BUY_URL", "LIGHTS_URL", "PRO_PRICE", "LICENCE_PATH"):
        assert re.search(rf"export const {name}\s*=", s), f"editions.js no longer exports {name}"
    assert BUY_URL in s, "editions.js BUY_URL is not the purchase page"


def test_the_server_refusal_says_where_to_go() -> None:
    """The backend is the real gate; its message is what a scripted client sees."""
    s = _read(_CC / "ws_fabric.py")
    assert "_PRO_REQUIRED_MSG" in s, "the shared refusal constant is gone"
    msg = re.search(r"_PRO_REQUIRED_MSG = \((.*?)\)", s, re.S)
    assert msg, "could not read _PRO_REQUIRED_MSG"
    body = msg.group(1)
    assert BUY_URL in body, "the refusal does not say where to get a key"
    for bit in LICENCE_PATH_BITS:
        assert bit in body, f"the refusal does not name the licence card ({bit!r} missing)"

    # Both gates must use the constant rather than repeating a literal, so the
    # two can never say different things.
    literals = s.count('"Light placement needs PadSpan Bright Pro or PadSpan Pro"')
    assert literals == 0, "a gate is still using its own literal message"
    assert s.count('"pro_required", _PRO_REQUIRED_MSG') == 2, (
        "expected exactly the two light-placement gates to use the shared message")


def test_no_view_points_at_a_licence_surface_that_does_not_exist() -> None:
    """'Settings → PadSpan Pro' was never a real place. It must not come back."""
    for p in sorted(_VIEWS.glob("*.js")):
        s = _read(p)
        assert "Settings → PadSpan Pro" not in s, f"{p.name} points at a surface that does not exist"
        assert "Settings → PadSpan Pro" not in s, f"{p.name} points at a surface that does not exist"


def test_the_licence_card_exists_and_is_rendered() -> None:
    """It must not go back to living inside the Forensics toggle."""
    s = _read(_VIEWS / "settings.js")
    assert "function _settingsLicence(" in s, "the licence card is gone"
    assert "_settingsLicence(ctx, el)" in s, "the licence card is never rendered"
    # It must offer both actions: enter a key, and buy one.
    card = s[s.index("function _settingsLicence("):]
    card = card[:card.index("\nfunction ")] if "\nfunction " in card else card
    assert "forensics_license_activate" in card, "the card cannot activate a key"
    assert "BUY_URL" in card, "the card does not link to the purchase page"


def test_the_lights_gate_offers_a_way_forward() -> None:
    s = _read(_VIEWS / "maps.js")
    i = s.find("Free lighting map. ")
    assert i > 0, "the free-lighting notice is gone"
    notice = s[i:i + 900]
    assert "_LIC_PATH" in notice, "the notice does not say where to enter a key"
    assert "_LIC_BUY_URL" in notice, "the notice does not link to the purchase page"
