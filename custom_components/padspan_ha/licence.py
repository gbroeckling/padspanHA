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

ADD-ONS sit beside the ladder, not on it (the owner, 2026-11-25). One feature
each, sold to installs without Pro; Pro includes them all. A buyer's add-ons
share one key, which resolves to `free` and carries them: license_addons (the
ones the server says are running) and license_addons_until (each one's end,
with the same grace as a key). The licence server answers an add-on key only
to a PadSpan that says which add-ons it knows (licence_homes.home_params),
because an older one would read any valid key as Pro; and here a key that
carries an add-on but names no tier reads `free`, never `pro`.
addon_allowed(settings, key_active, name) is the one rule; a new add-on is a
name in ADDONS (and a line in the licence server's and the site's tables).
"""

from __future__ import annotations

import time
from typing import Any

from .build_info import EDITION, TIER_FLOOR
from .const import DATA_SETTINGS, DOMAIN, FREE_BASICS_FROM_TS

TIERS: tuple[str, ...] = ("free", "bright", "pro")
_RANK = {t: i for i, t in enumerate(TIERS)}
# The add-ons this PadSpan knows. Sent with every validate (licence_homes.home_params);
# views/editions.js ADDONS has their words and prices.
ADDONS: tuple[str, ...] = ("audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks", "forensics",
                           "insights", "maps", "lighting", "vacuum", "c4local")
# The plan the licence server names an add-on key's answers with. Stored with the key (license_plan) at activation
# and on every check, so a key whose add-ons this PadSpan doesn't know yet still reads as an add-on key, never Pro.
ADDON_PLAN = "addons"
# The licence server's answer status for an add-on key whose add-ons are all newer than this PadSpan: kept as
# license_home_status, said on the licence card ("This add-on needs a newer PadSpan — update PadSpan."), never Pro.
NEEDS_UPDATE = "needs_update"
# Add-ons that go on sale at a moment (the owner, 2026-11-25): "maps" (Advanced map creation) and "vacuum" (Robot
# vacuum) go on sale with the free basics, December 1 (const.FREE_BASICS_FROM_TS). PadSpan Pro includes them
# meanwhile; nothing offers them (views/editions.js ADDONS on_sale_from says the same), and a feature that is free
# today and moves into one stays everyone's until it is on sale (hass_addon_gate), so nobody loses one before it can
# be bought. Read on every call: an install running across the moment switches by itself.
ADDON_ON_SALE_FROM: dict[str, int] = {"maps": FREE_BASICS_FROM_TS, "vacuum": FREE_BASICS_FROM_TS}
# Add-ons not on sale, with no moment yet. Specialty (the owner, 2026-11-25): c4local, OS 2 Local for Control4, a
# separate integration PadSpan can install (c4local_install.py). One payment for life (no end date: the server's list
# of running add-ons decides), never in a sale, PadSpan Pro includes it; not on sale until the product is published
# (views/editions.js on_sale: false says the same). Nothing free moves into it, so its gate is Pro or the add-on
# (hass_addon_allowed) whether or not it is on sale.
NOT_ON_SALE: tuple[str, ...] = ("c4local",)

# The clock the moments here are read by (the tests pin it: tests/conftest.py).
_clock = time.time


def _now(now: float | None = None) -> float:
    """The time a moment is read at: `now` (a Unix time) when given, else the clock."""
    return _clock() if now is None else float(now)


def addon_on_sale(name: str, now: float | None = None) -> bool:
    """Whether add-on `name` is sold at `now` (a known add-on not in NOT_ON_SALE whose ADDON_ON_SALE_FROM moment, if
    any, has come)."""
    return name in ADDONS and name not in NOT_ON_SALE and _now(now) >= ADDON_ON_SALE_FROM.get(name, 0)


def addons_on_sale(now: float | None = None) -> list[str]:
    """Every add-on on sale at `now`, in ADDONS order: the settings payload's addons_on_sale, which the panel's
    gates read (views/editions.js addonGate), so the panel and this side switch on one clock."""
    return [a for a in ADDONS if addon_on_sale(a, now)]


def normalize_addons(value: Any) -> list[str]:
    """The add-ons a server answer (or the store) names: known ones only, in
    ADDONS order. Anything that is not a list of them is none."""
    if not isinstance(value, (list, tuple)):
        return []
    got = {v.strip().lower() for v in value if isinstance(v, str)}
    return [a for a in ADDONS if a in got]


def normalize_addons_until(value: Any) -> dict[str, str]:
    """Each add-on's end as the server gave it ({name: "YYYY-MM-DD HH:MM:SS"}):
    known add-ons with a string date only, in ADDONS order."""
    if not isinstance(value, dict):
        return {}
    return {a: value[a][:32] for a in ADDONS if isinstance(value.get(a), str) and value[a].strip()}


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
    if str(d.get("license_plan") or "") == ADDON_PLAN or str(d.get("license_home_status") or "") == NEEDS_UPDATE:
        return "free"                                  # an add-on key, whatever else is stored
    tier = normalize_tier(d.get("license_tier"), default="")
    if tier:
        return tier
    addon_key = normalize_addons(d.get("license_addons")) or normalize_addons_until(d.get("license_addons_until"))
    return "free" if addon_key else "pro"


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


# ── Features that move down the ladder ──────────────────────────────────────
# One switch moves three features to the bottom rung at once: exact placement
# of lights and devices on the Atlas (from bright), the plain full-screen wall
# mode and the 3D house's basics (both from pro). Nothing else moves with
# them: fixture shapes, Showcase and the rest of the lighting tier stay at
# bright; the wall's night dimming, burn-in shift and floor cycling, and the
# 3D house's furniture, AI features, people figures and editor stay at pro.
#
# Still one ladder: each gate asks tier_at_least, only the rung it asks for
# moves. Off, every rung is where it always was, and the settings payload
# does not even say the switch exists (ws_common: free_basics only while on).
# The frontend's mirror is views/editions.js (placementTier, wallTier,
# house3dTier), which reads settings.free_basics. tests/test_free_basics.py.
#
# The switch is a moment (the owner, 2026-11-25): from const.FREE_BASICS_FROM_TS
# (December 1, 00:00 Pacific) it is on, read on every call, so an install
# running across the moment switches without a restart, and the panel with the
# next settings read. tests/test_free_basics_dec1.py.
def free_basics(now: float | None = None) -> bool:
    """Whether the free basics are on at `now` (from const.FREE_BASICS_FROM_TS)."""
    return _now(now) >= FREE_BASICS_FROM_TS


def placement_tier() -> str:
    """The rung exact placement of lights and devices needs."""
    return "free" if free_basics() else "bright"


def house3d_tier() -> str:
    """The rung the 3D house (Live Aboard) needs to show at all."""
    return "free" if free_basics() else "pro"


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


def answer_tier(data: Any) -> str:
    """The tier a licence-server answer gives its key, on every path that
    stores one (activation, the trial, the daily check, an invite claim). An
    add-on key's is always `free`: its plan says so whatever its tier says, and
    an answer that names add-ons but no known tier is never read as Pro. Any
    other answer: the tier it names, a missing or unknown one Pro (key_tier)."""
    d = data if isinstance(data, dict) else {}
    # needs_update: an add-on key whose add-ons are all newer than this PadSpan (the licence server's answer). Nothing
    # about it is Pro, whatever else the answer carries.
    if str(d.get("plan") or "") == ADDON_PLAN or str(d.get("status") or "") == NEEDS_UPDATE:
        return "free"
    tier = normalize_tier(d.get("tier"), default="")
    if tier:
        return tier
    return "free" if normalize_addons(d.get("addons")) or normalize_addons_until(d.get("addons_until")) else "pro"


def is_addon_key(settings: dict[str, Any] | None) -> bool:
    """Whether this install's key is an add-on key (not a Pro key), lapsed or
    not. The settings payload says it as addon_key, beside pro_has_key (which
    stays "a licence key is on this install"). Any stored key that resolves to
    tier free is one (key_tier: the plan "addons", needs_update, or a free tier
    with add-ons this PadSpan may not know, even none it can name): only add-on
    keys are free, so it is never read as Pro, whatever add-ons it lists."""
    d = settings or {}
    return bool(str(d.get("forensics_license_key") or "").strip()) and key_tier(d) == "free"


# An add-on key, as kept aside while a Pro trial runs on this install
# (license_addons_kept): the trial key takes its place, and it comes back when
# the trial ends (ws_forensics.ws_trial_start, update_check._revalidate_license).
ADDON_KEY_FIELDS: tuple[str, ...] = ("forensics_license_key", "forensics_license_expires", "license_tier", "license_addons",
                                     "license_addons_until", "license_plan", "license_home_token", "license_homes_used")


def addon_allowed(settings: dict[str, Any] | None, key_active: bool, name: str, *,
                  floor: str | None = None, now: Any = None) -> bool:
    """Whether add-on `name`'s features may be used: always on the Pro tier
    (Pro includes every add-on); else the key is active and carries it, until
    its own end plus the grace a key gets (ws_common.PRO_GRACE_DAYS). With no
    end known, the server's list of running add-ons decides. The panel reads
    the answer as settings.addons_licensed (ws_common._get_settings) through
    views/editions.js addonAllowed(settings, name)."""
    d = settings or {}
    if tier_at_least(effective_tier(d, key_active, floor=floor), "pro"):
        return True
    if name not in ADDONS or not key_active or not str(d.get("forensics_license_key") or "").strip():
        return False
    end = normalize_addons_until(d.get("license_addons_until")).get(name)
    if end:
        from datetime import datetime, timedelta, timezone  # noqa: PLC0415
        from .ws_common import PRO_GRACE_DAYS  # noqa: PLC0415
        try:
            when = datetime.fromisoformat(end.replace("Z", "+00:00"))
        except ValueError:
            when = None
        if when is not None:
            when = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
            return (now or datetime.now(timezone.utc)) < when + timedelta(days=PRO_GRACE_DAYS)
    return name in normalize_addons(d.get("license_addons"))


def addons_allowed(settings: dict[str, Any] | None, key_active: bool) -> list[str]:
    """Every add-on addon_allowed() lets this install use, in ADDONS order."""
    return [a for a in ADDONS if addon_allowed(settings, key_active, a)]


def hass_addon_allowed(hass: Any, name: str) -> bool:
    """addon_allowed from a running Home Assistant — the one call sites use."""
    from .ws_common import _pro_expiry_state  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    settings = (st.data if st else {}) or {}
    return addon_allowed(settings, bool(_pro_expiry_state(hass)["active"]), name)


def hass_addon_or_bright(hass: Any, name: str) -> bool:
    """Add-on `name` (PadSpan Pro has it), or a Bright key, which had it before the add-ons: a feature that was
    Bright's or Pro's never leaves a Bright key (Alarm & security, Advanced smart lighting). views/lights_map.js
    designUnlocked and lights_panel.js _alarmControls say the same in the panel."""
    return hass_tier_at_least(hass, "bright") or hass_addon_allowed(hass, name)


def hass_addon_gate(hass: Any, name: str) -> bool:
    """The gate of a feature that was free and moves into add-on `name`: everyone's while the add-on is not on sale
    (addon_on_sale; nobody could buy it), then hass_addon_allowed. views/editions.js addonGate is its twin."""
    return not addon_on_sale(name) or hass_addon_allowed(hass, name)
