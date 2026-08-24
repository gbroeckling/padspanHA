"""A switch in Settings must switch something on.

Three toggles shipped in Settings → Features for months and did nothing at all:
Trackability Rating, Compass Ring Calibration and Replay Timeline. They were
settings keys with a label and a paragraph of description, wired to a schema, a
default and the usage report — and read by no code anywhere. A user could enable
"Trackability Rating", see a confirmation, and receive a feature that did not
exist. They were also advertised on padspan.traks.ca.

`test_telemetry.py` keeps such a key out of the usage report and
`test_site_claims.py` keeps it off the storefront. This keeps it out of the
product: every toggle offered in the Features tab must be READ somewhere outside
the settings plumbing that stores it.
"""
from __future__ import annotations

import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_SETTINGS_JS = _CC / "www" / "padspan-ha" / "views" / "settings.js"
_WS_SETTINGS = _CC / "ws_settings.py"
_STORE = _CC / "settings_store.py"

# Files that only STORE or PRESENT a setting. A key that appears solely here is
# a key nothing acts on.
_PLUMBING = {"settings.js", "ws_settings.py", "settings_store.py", "telemetry.py"}

RETIRED = ("trackability_rating_enabled", "compass_ring_enabled", "replay_timeline_enabled")


def _feature_keys() -> list[str]:
    """The toggles offered in Settings → Features."""
    s = _SETTINGS_JS.read_text(encoding="utf-8")
    m = re.search(r"const features = \[(.*?)\n  \];", s, re.S)
    assert m, "could not find the features array in settings.js"
    return re.findall(r'key:\s*"([a-z0-9_]+)"', m.group(1))


def _consumer_source() -> str:
    parts = []
    for p in list(_CC.rglob("*.py")) + list(_CC.rglob("*.js")):
        if p.name in _PLUMBING or "__pycache__" in p.parts:
            continue
        parts.append(p.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts)


def test_every_feature_toggle_is_read_by_something() -> None:
    keys = _feature_keys()
    assert keys, "no feature toggles found — did the Features tab move?"
    src = _consumer_source()
    dead = [k for k in keys if k not in src]
    assert not dead, (
        "these toggles are offered in Settings → Features but no code outside the "
        f"settings plumbing ever reads them, so switching them on does nothing: {dead}. "
        "Either wire the feature up or take the switch out.")


def test_the_three_retired_toggles_are_gone() -> None:
    """Named explicitly because they were shipped, documented and advertised."""
    js = _SETTINGS_JS.read_text(encoding="utf-8")
    ws = _WS_SETTINGS.read_text(encoding="utf-8")
    store = _STORE.read_text(encoding="utf-8")
    for k in RETIRED:
        assert f'key: "{k}"' not in js, f"{k} is offered as a toggle again"
        assert f'vol.Optional("{k}")' not in ws, f"{k} is back in the settings schema"
        assert f'"{k}":' not in store, f"{k} is back in the stored defaults"
