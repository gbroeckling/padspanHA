# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""An Android phone's BLE Transmitter on settings too weak to be heard.

The Companion app starts its transmitter at its lowest power, in its
power-saving advertise mode, and receivers barely hear a phone like that.
PadSpan never said so, and its phone guide told people to keep the settings
as they were. Track Your Phone now warns on the phone's own row and says
what to set; the guide (English and German) says the same; and the Bluetooth
view no longer sends Android owners looking for a key they don't need.

tests/js/phone_transmitter.mjs runs the shipped overview.js and bluetooth.js.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_GUIDE = _ROOT / "site" / "guides" / "phone-room-presence"


@pytest.fixture(scope="module")
def run() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "phone_transmitter.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{r.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("rule:", 7), ("basic:", 3), ("advanced:", 3), ("irk manager:", 2)])
def test_the_weak_transmitter_warning(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_guide_says_what_to_set_in_both_languages() -> None:
    if not (_GUIDE / "index.html").is_file():
        pytest.skip("no site/ in this tree (the Bright derivation carries none)")
    en = (_GUIDE / "index.html").read_text(encoding="utf-8")
    de = (_GUIDE / "de" / "index.html").read_text(encoding="utf-8")
    assert "Start with its settings as they are" not in en
    assert "Lass seine Einstellungen erst einmal, wie sie sind" not in de
    # The card the warning is on, as the panel names it in each language.
    for page, card in ((en, "Track Your Phone"), (de, _german("Track Your Phone"))):
        assert "<b>Transmit power</b> auf <b>High</b>" in page or "<b>Transmit power</b> to <b>High</b>" in page
        assert "<b>Advertise mode</b> auf <b>Low latency</b>" in page or "<b>Advertise mode</b> to <b>Low latency</b>" in page
        assert card in page


def _german(english: str) -> str:
    """The German panel's words for `english`: i18n/de, every group the panel loads (all but the help)."""
    for p in sorted((_ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "i18n" / "de").glob("*.json")):
        word = json.loads(p.read_text(encoding="utf-8")).get(english) if p.name != "help.json" else None
        if isinstance(word, str):
            return word
    return english
