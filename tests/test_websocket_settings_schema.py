"""The settings_set websocket schema must accept every persisted setting.

HA's websocket_api validates an incoming message against the command's
voluptuous schema and rejects anything carrying a key the schema doesn't
declare. A setting that exists in SettingsStore.DEFAULTS and has a frontend
toggle, but was never added to the schema, therefore looks like a UI that
"doesn't save" — the save is refused at the transport layer before any
handler code runs. That is exactly how the Light Theme toggle (issue #58)
shipped broken.
"""

from __future__ import annotations

import re
from pathlib import Path

from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS


def _schema_keys() -> set[str]:
    """Declared keys of the padspan_ha/settings_set command schema."""
    schema = ws.ws_settings_set.ws_schema   # recorded by the conftest stub
    return {str(getattr(k, "schema", k)) for k in schema}


# Settings the frontend never sends over settings_set: they are written by
# backend code paths (their own websocket commands or internal bookkeeping).
_BACKEND_ONLY = {
    "forensics_license_key",       # padspan_ha/forensics_license_activate
    "forensics_license_expires",   # ditto — derived at activation
    "irk_devices",                 # private-BLE resolver bookkeeping
    "room_tag_map",                # tag integration / live snapshot
    "telemetry_install_id",        # minted by telemetry.py; replaced via telemetry_reset_id
    "telemetry_last_day",          # stamped by telemetry.py on an accepted send
}


def test_light_theme_is_accepted():
    """Issue #58: the Light Theme toggle could not persist."""
    assert "light_theme" in _schema_keys()


def test_every_default_setting_is_settable():
    missing = sorted(
        k for k in DEFAULT_SETTINGS
        if k not in _schema_keys() and k not in _BACKEND_ONLY
    )
    assert not missing, (
        "settings_set schema is missing keys that exist in DEFAULT_SETTINGS — "
        f"their UI will silently fail to save: {missing}"
    )


# ── The other direction ──────────────────────────────────────────────────────
# Sweeping the store's defaults is not enough: a setting the frontend sends but
# that was never given a default is invisible to that check, and just as broken
# (overview_show_walls shipped that way — the Overview "Walls" toggle could
# never persist). So also read what the UI actually sends.

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
_CALL_RE = re.compile(r"settingsSet\s*\(\s*\{|padspan_ha/settings_set")
_KEY_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:")


def _payload_keys(src: str) -> set[str]:
    """Top-level keys of every settings_set payload literal in one JS file."""
    keys: set[str] = set()
    for m in _CALL_RE.finditer(src):
        start = src.find("{", m.start())
        if start < 0:
            continue
        depth, i = 0, start
        while i < len(src):                      # brace-match the object literal
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = src[start + 1:i]
        # Only top-level keys: drop nested object/array literals first.
        flat, depth = [], 0
        for ch in body:
            if ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
            elif depth == 0:
                flat.append(ch)
        keys |= set(_KEY_RE.findall("".join(flat)))
    return keys


def test_every_setting_the_frontend_sends_is_accepted():
    sent: set[str] = set()
    for path in _WWW.rglob("*.js"):
        if "/lib/" in path.as_posix():
            continue
        sent |= _payload_keys(path.read_text(encoding="utf-8", errors="replace"))
    sent -= {"type"}                    # websocket envelope, not a setting
    missing = sorted(k for k in sent if k not in _schema_keys())
    assert not missing, (
        "the frontend sends settings_set keys the schema does not accept — "
        f"those controls silently fail to save: {missing}"
    )
