"""?view= links open the view they name (issue #93).

The deep-link block promises a ?view= link opens its view "regardless of the
browser's complexity mode" (wall monitors have fresh localStorage), but
_renderNav sent any view the menu didn't list back to the first menu item.
Forensics lost even when switched on: the first nav render comes before the
settings that turn it on, and nothing put the linked view back. The real-panel
check is the UI harness (all five cases pass); these hold the wiring.
"""

from __future__ import annotations

from pathlib import Path

_PANEL = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
SRC = _PANEL.read_text(encoding="utf-8")


def _body(name: str) -> str:
    at = SRC.index(f"  {name}(")
    return SRC[at:SRC.index("\n  }\n", at)]


def test_the_menu_keeps_a_linked_view():
    nav = _body("_renderNav")
    assert "!this._keepsLinkedView(this.state.view)" in nav


def test_only_what_really_isnt_there_sends_a_link_back():
    keep = _body("_keepsLinkedView")
    assert "view !== this._urlPinnedView" in keep           # only the linked view
    assert "if (!this._settingsLoaded) return true;" in keep  # unknown until settings arrive
    assert 'view === "forensics" && settings.forensics_enabled !== true' in keep
    assert "surfacesForEdition([view], settings)" in keep    # a view this edition (Bright) doesn't have


def test_the_first_settings_recheck_the_menu():
    fetch = _body("async _fetchSettings")
    assert "this._settingsLoaded = true;" in fetch and "if (first && this.$nav) this._renderNav();" in fetch
    assert "this._settingsLoaded = true;" in _body("async _loadSettings")
