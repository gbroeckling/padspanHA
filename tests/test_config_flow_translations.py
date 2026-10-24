# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The config-flow / services translation files stay in step with strings.json.

Home Assistant falls back to English per key, so a language file that lacks a
block is not an error, it is a SILENT one: every German user saw the WLED
actions in English because no language file had a `services` block at all.
Same "two lists, one updated" guard as the help-content tests.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

_INTEG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_TR = _INTEG / "translations"
_PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}")


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _leaves(d: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_leaves(v, key))
        else:
            out[key] = v
    return out


def _languages() -> list[Path]:
    return sorted(p for p in _TR.glob("*.json") if p.stem != "en")


def test_en_json_matches_strings_json():
    assert _load(_TR / "en.json") == _load(_INTEG / "strings.json")


def test_every_language_has_exactly_the_english_keys():
    en = set(_leaves(_load(_TR / "en.json")))
    assert len(_languages()) >= 10
    for p in _languages():
        keys = set(_leaves(_load(p)))
        assert keys == en, f"{p.name}: missing {sorted(en - keys)}, extra {sorted(keys - en)}"


def test_values_are_plain_text_with_the_english_placeholders():
    en = _leaves(_load(_TR / "en.json"))
    for p in _languages():
        for key, val in _leaves(_load(p)).items():
            assert isinstance(val, str) and val.strip(), f"{p.name}:{key} is empty"
            assert "<" not in val and ">" not in val, f"{p.name}:{key} contains markup"
            assert set(_PLACEHOLDER_RE.findall(val)) == set(_PLACEHOLDER_RE.findall(en[key])), \
                f"{p.name}:{key} placeholders differ from English"


def test_languages_are_translated_not_english_copies():
    en = _leaves(_load(_TR / "en.json"))
    for p in _languages():
        tr = _leaves(_load(p))
        for key in ("config.step.user.title", "services.wled_on.description",
                    "services.wled_off.description"):
            assert tr[key] != en[key], f"{p.name}:{key} is still English"


def test_translated_services_exist_in_services_yaml():
    services = yaml.safe_load((_INTEG / "services.yaml").read_text(encoding="utf-8"))
    for name, block in _load(_INTEG / "strings.json").get("services", {}).items():
        assert name in services, f"strings.json translates unknown service {name}"
        assert set(block.get("fields", {})) == set((services[name] or {}).get("fields", {})), \
            f"strings.json fields for {name} differ from services.yaml"
