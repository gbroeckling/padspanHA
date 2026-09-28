# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Putting the trial where people are (Garry, 2026-09-28).

Opt-in reports from 42 installs: 40 on the free tier, 5 with the Atlas
sidebar panel on (it was off by default), and a trial that was reachable
only through a prompt() in Settings and had been started twice. This holds:

  1. Atlas on by default, and switched on ONCE for installs from before —
     nobody chose "off", it was the default — then never again, so an off
     chosen after the update stays off. panel.py reads the setting at setup,
     after the settings store has loaded, so the sidebar entry appears on
     the restart the update needs, in either edition.
  2. The usage events the trial card and Getting started card fire are in
     the closed vocabulary, nothing else like them is, none of them can
     carry an email, and the lists match the frontend's own.
  3. tests/js/trial_offer.mjs, run: the card itself (views/trial_offer.js)
     and the Getting started card's "someone on the map" step.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import settings_store as ss
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WWW = _CC / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_HARNESS = Path(__file__).parent / "js" / "trial_offer.mjs"
_NODE = shutil.which("node")


async def _load(loaded):
    saved: dict = {}
    store = ss.SettingsStore.__new__(ss.SettingsStore)
    store.store = SimpleNamespace(async_load=AsyncMock(return_value=loaded),
                                  async_save=AsyncMock(side_effect=lambda d: saved.update(d)))
    data = await store.async_load()
    return store, data, saved


# ═══ 1. Atlas on by default, once ═════════════════════════════════════════════

def test_atlas_is_on_by_default() -> None:
    assert ss.DEFAULT_SETTINGS["lights_panel_enabled"] is True
    assert ss.DEFAULT_SETTINGS["atlas_default_v1_applied"] is False


async def test_an_existing_install_gets_atlas_turned_on_once_and_saved() -> None:
    # Off because it was the default, from a version that never had the flag.
    _, data, saved = await _load({"lights_panel_enabled": False, "light_theme": True})
    assert data["lights_panel_enabled"] is True
    assert data["atlas_default_v1_applied"] is True
    assert saved["lights_panel_enabled"] is True and saved["atlas_default_v1_applied"] is True, (
        "the one-time switch was not persisted — it would run again on every boot")
    assert data["light_theme"] is True, "the migration touched another setting"


async def test_off_chosen_after_the_update_stays_off() -> None:
    _, data, saved = await _load({"lights_panel_enabled": False, "atlas_default_v1_applied": True})
    assert data["lights_panel_enabled"] is False, "a deliberate off was overridden"
    # Nothing new to add, so nothing is re-saved on its account.
    assert "lights_panel_enabled" not in saved or saved["lights_panel_enabled"] is False


async def test_a_fresh_install_has_atlas_on_and_the_flag_recorded() -> None:
    _, data, saved = await _load(None)
    assert data["lights_panel_enabled"] is True and data["atlas_default_v1_applied"] is True
    assert saved.get("atlas_default_v1_applied") is True


async def test_an_install_that_already_had_it_on_is_left_on() -> None:
    _, data, _ = await _load({"lights_panel_enabled": True})
    assert data["lights_panel_enabled"] is True and data["atlas_default_v1_applied"] is True


def _fake_panel_custom(monkeypatch) -> list[dict]:
    calls: list[dict] = []
    fake = ModuleType("homeassistant.components.panel_custom")
    fake.async_register_panel = lambda **kw: calls.append(kw)
    monkeypatch.setitem(sys.modules, "homeassistant.components.panel_custom", fake)
    monkeypatch.setattr(sys.modules["homeassistant.components"], "panel_custom", fake, raising=False)
    return calls


@pytest.mark.parametrize("edition", ["full", "bright"])
async def test_the_atlas_panel_is_registered_after_the_migration(monkeypatch, edition) -> None:
    """The order that makes the update show the panel: settings load (and
    migrate) as a critical store, then panel.py reads the setting."""
    from custom_components.padspan_ha import panel
    monkeypatch.setattr(panel, "edition", lambda: edition)
    calls = _fake_panel_custom(monkeypatch)
    store, _, _ = await _load({"lights_panel_enabled": False})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    await panel.async_setup_panel(hass)
    paths = [c["frontend_url_path"] for c in calls]
    assert paths == ["padspan-ha", "padspan-lights"], paths
    atlas = calls[1]
    assert atlas["sidebar_title"] == "Atlas" and atlas["require_admin"] is False
    assert "lights_panel.js?v=" in atlas["module_url"]


async def test_the_atlas_panel_is_not_registered_when_turned_off(monkeypatch) -> None:
    from custom_components.padspan_ha import panel
    calls = _fake_panel_custom(monkeypatch)
    store, _, _ = await _load({"lights_panel_enabled": False, "atlas_default_v1_applied": True})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: store}}
    await panel.async_setup_panel(hass)
    assert [c["frontend_url_path"] for c in calls] == ["padspan-ha"]


def test_settings_load_before_the_panel_is_registered() -> None:
    """__init__.py: settings are a critical store, and the panel is set up
    after the critical stores — otherwise panel.py reads no setting at all
    and the migration's panel would not appear until a second restart."""
    src = (_CC / "__init__.py").read_text(encoding="utf-8")
    i_setup = src.index("async def async_setup(")
    body = src[i_setup:]
    assert body.index("critical_only=True") < body.index("await async_setup_panel(hass)"), (
        "the panel is registered before the settings store has loaded")
    assert "critical.append(_init_settings())" in src


# ═══ 2. The usage events ══════════════════════════════════════════════════════

def test_the_offer_events_are_allowed_and_closed() -> None:
    want = ({f"{w}:{s}" for w in ("trial_offer_shown", "trial_started", "trial_failed") for s in T.TRIAL_SURFACES}
            | {f"getting_started_step:{s}" for s in T.GETTING_STARTED_STEPS}
            | {"getting_started_shown", "getting_started_dismissed"})
    assert T.OFFER_EVENTS == frozenset(want)
    assert all(T.event_allowed(e) for e in T.OFFER_EVENTS)
    for bad in ("trial_offer_shown:kitchen", "trial_started:", "trial_started:someone@example.com",
                "getting_started_step:nope", "trial_offer_shown", "getting_started_step:"):
        assert not T.event_allowed(bad), bad


def test_offer_events_are_counted_and_pass_the_report_checks() -> None:
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}}
    for e in sorted(T.OFFER_EVENTS):
        assert T.bump(h, e), e
    usage = h.data[DOMAIN][T._DATA_COUNTERS]
    assert set(usage) == set(T.OFFER_EVENTS)
    # Every name is a shape the report accepts — no dot (an entity id), no @.
    payload = {"schema": 1, "install_id": "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60", "usage": usage}
    T.assert_shareable(payload)
    assert not any("@" in e or "email" in e for e in T.OFFER_EVENTS)


def test_offer_events_are_not_counted_with_the_report_off() -> None:
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": False})}}
    assert not T.bump(h, "trial_started:atlas")


def test_every_surface_is_fired_somewhere() -> None:
    """A surface in the list that no code ever names is a count that is
    always zero and reads as 'nobody saw it'."""
    src = "\n".join(p.read_text(encoding="utf-8") for p in _WWW.rglob("*.js"))
    for s in T.TRIAL_SURFACES:
        assert f'"{s}"' in src, f"no surface named {s} in the panel"


def test_the_server_receiver_needs_no_change() -> None:
    """server/telemetry.php takes any usage key (it checks shapes, not names)
    — so these events reach the spool without a colo deploy."""
    path = _ROOT / "server" / "telemetry.php"
    if not path.exists():
        pytest.skip("no server/ in this build (the Bright repo ships without it)")
    php = path.read_text(encoding="utf-8")
    assert "'usage'" in php
    assert "tab:" not in php and "trial" not in php, "the receiver now names usage keys — re-read this test"


# ═══ 3. The card, run ═════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_HARNESS), str(_VIEWS), str(_WWW / "panel.js")],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"no result from the harness:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}"
    out = json.loads(lines[-1])
    out["_returncode"], out["_stderr"] = res.returncode, res.stderr
    return out


def test_the_trial_card_behaves(run) -> None:
    assert not run["failed"] and run["_returncode"] == 0, "\n".join(run["failed"]) + "\n" + run["_stderr"][-2000:]
    assert run["passed"] >= 15, run["passed"]


def test_the_frontend_and_telemetry_py_name_the_same_surfaces_and_steps(run) -> None:
    assert run["surfaces"] == list(T.TRIAL_SURFACES)
    assert run["steps"] == list(T.GETTING_STARTED_STEPS)


def test_the_old_prompt_is_gone_and_the_wording_is_90_days() -> None:
    settings = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    card = settings[settings.index("function _settingsLicence("):]
    card = card[:card.index("\nfunction ")]
    assert "prompt(\"Start your" not in card and "trial_start" not in card, "the licence card still prompts for the email"
    assert 'trialOfferFromCtx(ctx, "settings"' in card
    for p in list(_VIEWS.glob("*.js")) + [_WWW / "panel.js", _WWW / "lights_panel.js"]:
        assert "3-month" not in p.read_text(encoding="utf-8"), f"{p.name} still says 3-month"


def test_every_new_import_carries_the_cache_buster() -> None:
    for name in ("settings.js", "maps.js", "locate.js", "busy_times.js"):
        src = (_VIEWS / name).read_text(encoding="utf-8")
        assert "import(`./trial_offer.js${new URL(import.meta.url).search}`)" in src, name
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "import(`./views/trial_offer.js${new URL(import.meta.url).search}`)" in lp
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert "import(`./views/trial_offer.js?b=${BUILD_ID}`)" in panel
