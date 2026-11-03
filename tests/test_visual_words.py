# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Wrong words on screen (visual check of 2026-11-01).

Raw ids where a name belongs, the developer named in public text, "fabric" left
in Settings, headings said twice, a debug line, and "switch to Live" in Live.
Only what's displayed changed: ids, settings keys and stored values did not.

tests/js/visual_words.mjs renders the screens; the rest is held here in the
source, comments aside (test_plain_names.py's reader of string literals).
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"

_spec = importlib.util.spec_from_file_location("_plain_names", ROOT / "tests" / "test_plain_names.py")
_plain = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_plain)


def _read(rel: str) -> str:
    return (WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def _literals(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return [_plain._unescape(s) for s in _plain._literals(src)]


@pytest.fixture(scope="module")
def got() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "visual_words.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_screens_render_as_they_should(got) -> None:
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


@pytest.mark.parametrize("prefix", ["library:", "layout:", "legend:", "monitor:", "health:", "problems:", "manage:"])
def test_each_part_is_covered(got, prefix) -> None:
    assert any(k.startswith(prefix) for k in got), (prefix, sorted(got))


def test_public_text_does_not_name_the_developer() -> None:
    files = [p for p in sorted(WWW.glob("*.js")) + sorted((WWW / "views").glob("*.js"))]
    found = [(p.name, s[:80]) for p in files for s in _literals(p) if re.search(r"Garry|Broeckling", s)]
    assert not found, found
    for lang in ("de", "fr", "nl"):
        help_text = (WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8")
        assert not re.search(r"Garry|Broeckling", help_text), lang


def test_settings_says_saved_layout_not_fabric() -> None:
    found = [s[:80] for s in _literals(WWW / "views" / "settings.js") if re.search(r"\b[Ff]abric('s)?\s", s)]
    assert not found, found
    src = _read("views/settings.js")
    assert '["manual", "Standalone — use the saved layout"]' in src
    # What's stored and sent is unchanged.
    assert "padspan_ha/fabric_sync_mode_set" in src and "fabric_origin_lat" in src and "fabric_bearing_deg" in src


def test_every_screen_has_a_phone_title() -> None:
    src = _read("panel.js")
    paths = re.search(r"const _VIEW_PATHS = \{(.*?)\n\};", src, re.S).group(1)
    views = re.findall(r"^\s*(\w+):\s*\"\./views/", paths, re.M)
    menu = re.search(r"const MENU = \[(.*?)\n\];", src, re.S).group(1)
    listed = set(re.findall(r'\["(\w+)",', menu))
    titles = re.search(r"const UNLISTED_VIEW_TITLES = \{(.*?)\};", src).group(1)
    unlisted = set(re.findall(r"(\w+):", titles)) | {"setup"}  # Setup has its own line
    assert len(views) > 20
    assert not [v for v in views if v not in listed and v not in unlisted]
    assert 'UNLISTED_VIEW_TITLES[this.state.view] || "PadSpan"' in src
