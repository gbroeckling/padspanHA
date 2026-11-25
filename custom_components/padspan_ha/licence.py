# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The tier model — one owner of "what is this install allowed to do?".

Four programs, two dials. The EDITION is which build was downloaded (full or
bright); the TIER is what the key says. Everything else is the cross product:

    PadSpan HA          full    no key       free    the only keyless program
    PadSpan Pro         full    key: pro     everything, everywhere
    PadSpan Bright      bright  no key       free    lighting only, locked
    PadSpan Bright Pro  bright  key: bright  the whole lighting product

The key sets CAPABILITY, the edition sets VISIBILITY. A `pro` key typed into
a Bright install unlocks every lighting feature — it simply has nothing else
to show — so nobody ever has to answer "which key for which download".

The ladder `free < bright < pro` is strict — Pro is a superset — so every
gate is one comparison (tier_at_least), never a feature matrix.

    effective tier = max(SHIPPED FLOOR, what the key resolves to)

The floor is a build constant (build_info.TIER_FLOOR), never fetched: a
lighting map that needs the licence server before it draws is a map that
goes blank when the internet does. The server can only ever RAISE the tier.

THE ONE RULE THAT MUST NOT GO WRONG: a key with no `tier` field resolves to
`pro`. Every key issued before the field existed is a Pro key; getting this
backwards silently demotes every paying customer on the release that ships
it. tests/test_licence_tiers.py pins it.

The gate governs EDITING only, as it always has: data a user created stays
readable and exportable when a licence lapses.

ADD-ONS sit beside the ladder, not on it (the owner, 2026-11-25). The Audio
add-on is sold to installs without Pro: its key resolves to `free` and carries
"audio" (license_addons, from the server's `addons`). Pro includes every
add-on. The licence server answers an audio key only to a PadSpan that says it
knows add-ons (licence_homes.home_params), because an older one would read any
valid key as Pro; and here a key that carries an add-on but names no tier reads
`free`, never `pro`. audio_allowed() is the one rule.
"""

from __future__ import annotations

from typing import Any

from .build_info import EDITION, TIER_FLOOR
from .const import DATA_SETTINGS, DOMAIN

TIERS: tuple[str, ...] = ("free", "bright", "pro")
_RANK = {t: i for i, t in enumerate(TIERS)}
# The add-ons this PadSpan knows. Sent with every validate (licence_homes.home_params).
ADDONS: tuple[str, ...] = ("audio",)


def normalize_addons(value: Any) -> list[str]:
    """The add-ons a server answer (or the store) names: known ones only, in
    ADDONS order. Anything that is not a list of them is none."""
    if not isinstance(value, (list, tuple)):
        return []
    got = {v.strip().lower() for v in value if isinstance(v, str)}
    return [a for a in ADDONS if a in got]


def normalize_tier(value: Any, default: str = "free") -> str:
    """A tier string the ladder knows, or the default."""
    t = str(value or "").strip().lower()
    return t if t in _RANK else default


def tier_max(a: str, b: str) -> str:
    return a if _RANK.get(a, 0) >= _RANK.get(b, 0) else b


def tier_min(a: str, b: str) -> str:
    return a if _RANK.get(a, 0) <= _RANK.get(b, 0) else b


def key_tier(settings: dict[str, Any] | None) -> str:
    """What the stored key resolves to, ignoring expiry.

    No key → free. A key with a `license_tier` the server told us → that.
    A key with NO tier field → `pro`: every key issued before the field
    existed is a Pro key. This default is the demotion guard and must not
    change. A key that carries an add-on is never one of those: with no tier
    it reads `free`, so an add-on key can never become Pro here.
    """
    d = settings or {}
    if not str(d.get("forensics_license_key") or "").strip():
        return "free"
    tier = normalize_tier(d.get("license_tier"), default="")
    if tier:
        return tier
    return "free" if normalize_addons(d.get("license_addons")) else "pro"


def effective_tier(settings: dict[str, Any] | None, key_active: bool, *,
                   floor: str | None = None) -> str:
    """The tier this install runs at.

    max(floor, key tier) while the key is active (activated and inside the
    grace window), the floor otherwise. `license_tier_override` may only
    LOWER the result — it exists so a Pro developer can look at what a free
    or Bright user sees, and it can never be a way past the licence.
    """
    d = settings or {}
    fl = normalize_tier(floor if floor is not None else TIER_FLOOR, default="free")
    tier = tier_max(fl, key_tier(d)) if key_active else fl
    override = str(d.get("license_tier_override") or "").strip().lower()
    if override in _RANK:
        tier = tier_min(tier, override)
    return tier


def tier_at_least(tier: str, want: str) -> bool:
    return _RANK.get(normalize_tier(tier), 0) >= _RANK.get(normalize_tier(want, "pro"), 0)


def edition() -> str:
    """Which build this is: 'full' or 'bright' (build_info, stamped at release)."""
    return "bright" if str(EDITION).strip().lower() == "bright" else "full"


def hass_tier(hass: Any) -> str:
    """The effective tier from a running Home Assistant — the one call sites use."""
    # Local import: ws_common imports this module, and the expiry rule lives there.
    from .ws_common import _pro_expiry_state  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    settings = (st.data if st else {}) or {}
    return effective_tier(settings, bool(_pro_expiry_state(hass)["active"]))


def hass_tier_at_least(hass: Any, want: str) -> bool:
    return tier_at_least(hass_tier(hass), want)


def audio_allowed(settings: dict[str, Any] | None, key_active: bool, *,
                  floor: str | None = None) -> bool:
    """Whether the Audio add-on's controls may be used: the Pro tier (Pro
    includes every add-on), or an active key that carries "audio". The panel
    reads it as settings.audio_licensed (ws_common._get_settings)."""
    d = settings or {}
    if tier_at_least(effective_tier(d, key_active, floor=floor), "pro"):
        return True
    return (bool(key_active) and bool(str(d.get("forensics_license_key") or "").strip())
            and "audio" in normalize_addons(d.get("license_addons")))


def hass_audio_allowed(hass: Any) -> bool:
    """audio_allowed from a running Home Assistant — the one call sites use."""
    from .ws_common import _pro_expiry_state  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    settings = (st.data if st else {}) or {}
    return audio_allowed(settings, bool(_pro_expiry_state(hass)["active"]))
