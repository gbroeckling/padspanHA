"""Pure Live is called Live Tracker on screen; its route id stays `purelive`.

Only the visible name changed (2026-10-30): old links (?view=purelive), saved
tab lists, settings keys and report keys all still say purelive, so they keep
working. Comments and identifiers may still say Pure Live; displayed strings
(the menu, help, settings and wizard text, the Atlas switch) may not.
"""
from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code_strings(src: str) -> list[str]:
    """String literals of a JS file, with // and /* */ comments removed first."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)^\s*//.*$", "", src)
    return re.findall(r'"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`', src)


VISIBLE_FILES = [
    WWW / "panel.js",
    WWW / "help_content.js",
    WWW / "views" / "overview.js",
    WWW / "views" / "settings.js",
    WWW / "views" / "aboard_wizard.js",
    WWW / "views" / "installbase.js",
]


def test_menu_says_live_tracker_and_route_is_unchanged():
    src = _read(WWW / "panel.js")
    assert '["purelive","Live Tracker","mdi:lightning-bolt-outline"]' in src
    assert 'purelive: "./views/purelive.js"' in src
    assert '"purelive"' in re.search(r"ADVANCED_DEFAULT = new Set\(\[(.*?)\]\)", src).group(1)
    assert "?view=purelive" in src
    assert (WWW / "views" / "purelive.js").is_file()


def test_no_visible_pure_live_strings():
    for p in VISIBLE_FILES:
        bad = [s for s in _code_strings(_read(p)) if "Pure Live" in s]
        assert not bad, f"{p.name}: {bad}"


def test_help_translations_follow_the_new_name():
    help_src = _read(WWW / "help_content.js")
    for lang in ("de", "fr", "nl"):
        data = json.loads(_read(WWW / "i18n" / lang / "help.json"))
        assert not [k for k in data if "Pure Live" in k], lang
        assert not [v for v in data.values() if "Pure Live" in v], lang
        key = next(k for k in data if k.startswith("ADVANCED — The default"))
        assert "Live Tracker" in key and key in help_src.replace('\\"', '"')


def test_switch_label_and_report_keys():
    ov = _read(WWW / "views" / "overview.js")
    assert '"⚡ Live Tracker"' in ov
    assert '"live_switch_purelive"' in ov  # report event name unchanged
    ib = _read(WWW / "views" / "installbase.js")
    assert 'purelive: "Live Tracker"' in ib
