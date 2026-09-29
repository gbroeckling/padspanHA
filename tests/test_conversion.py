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
            | {"getting_started_shown", "getting_started_dismissed", "trial_nudge_dismissed"})
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


# ═══ 4. The quiet placements: the settings they rest on ═══════════════════════

def test_the_milestone_keys_have_defaults() -> None:
    assert ss.DEFAULT_SETTINGS["trial_nudge_done"] is False
    assert ss.DEFAULT_SETTINGS["first_seen_ts"] == 0


async def test_an_existing_install_is_stamped_first_seen_now_and_saved() -> None:
    """No first_seen_ts: stamped on this load, so the milestone's week counts
    from the update, not from the real install date."""
    import time
    before = time.time()
    _, data, saved = await _load({"light_theme": True, "atlas_default_v1_applied": True})
    assert before <= data["first_seen_ts"] <= time.time() + 1
    assert saved.get("first_seen_ts") == data["first_seen_ts"], "the stamp was not persisted"
    assert data["trial_nudge_done"] is False


async def test_first_seen_is_never_moved_once_set() -> None:
    _, data, _ = await _load({"first_seen_ts": 1_700_000_000.0, "atlas_default_v1_applied": True,
                              "trial_nudge_done": True})
    assert data["first_seen_ts"] == 1_700_000_000.0
    assert data["trial_nudge_done"] is True


@pytest.mark.parametrize("bad", [0, -5, None, "yesterday", True])
async def test_a_bad_first_seen_is_restamped(bad) -> None:
    _, data, _ = await _load({"first_seen_ts": bad, "atlas_default_v1_applied": True})
    assert isinstance(data["first_seen_ts"], float) and data["first_seen_ts"] > 1_600_000_000


def test_trial_nudge_done_is_settable_and_first_seen_is_not() -> None:
    src = (_CC / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("trial_nudge_done"): bool' in src
    assert 'payload["trial_nudge_done"] = bool(msg.get("trial_nudge_done"))' in src
    assert '"first_seen_ts"' not in src, "first_seen_ts is the backend's stamp, never the browser's"


def test_the_new_surfaces_and_the_dismissal_are_in_the_vocabulary() -> None:
    for s in ("update_banner", "milestone", "sidebar"):
        assert s in T.TRIAL_SURFACES
        for what in ("trial_offer_shown", "trial_started", "trial_failed"):
            assert T.event_allowed(f"{what}:{s}")
    assert T.event_allowed("trial_nudge_dismissed")
    assert not T.event_allowed("trial_nudge_dismissed:milestone")


def test_the_panel_placements_are_wired() -> None:
    """The three placements live in panel.js (tests/js/whats_new_card.mjs runs
    them): the banner's line inside _whatsNewCard, the milestone only where
    Getting started is not, and the sidebar entry built by _renderNav."""
    panel = (_WWW / "panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    wn = panel[panel.index("  _whatsNewCard(){"):panel.index("  _trialMilestoneCard(")]
    assert 'trialOfferFromCtx(this._ctx(), "update_banner"' in wn
    i = panel.index('} else if (this.state.view === "overview") {')
    tail = panel[i:i + 1500]
    assert "this._trialMilestoneCard(_hasPositioned)" in tail and "_setupKnown && _posKnown" in tail
    nav = panel[panel.index("  _renderNav(){"):panel.index("  _showHelp(")]
    assert "this._renderSidebarTrial();" in nav
    assert '<div id="navTrial"' in panel
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert ".app.mini #navTrial{display:none}" in css


# ═══ 5. Kept through a restore, a factory reset and a Bright import ═══════════
# Review 2026-09-28: none of the three carried trial_nudge_done or
# first_seen_ts, so a restore of an older backup (or a reset) brought the
# milestone card back to a house that had said "No thanks", or restarted its
# week. Like the licence, neither is house configuration.

def test_trial_state_kept_takes_an_answer_from_either_side_and_the_earliest_sighting() -> None:
    k = ss.trial_state_kept
    assert k({"trial_nudge_done": True}, {"trial_nudge_done": False})["trial_nudge_done"] is True
    assert k({}, {"trial_nudge_done": True})["trial_nudge_done"] is True
    assert k({}, {}) == {"trial_nudge_done": False}, "no sighting on either side: nothing invented"
    assert k({"first_seen_ts": 2_000.0}, {"first_seen_ts": 1_000.0})["first_seen_ts"] == 1_000.0
    assert k({"first_seen_ts": 0}, {"first_seen_ts": 1_000.0})["first_seen_ts"] == 1_000.0
    for bad in (0, -5, None, "yesterday", True):
        assert k({"first_seen_ts": bad}, None) == {"trial_nudge_done": False}, bad


def test_a_restore_keeps_the_later_whats_new_version() -> None:
    """Re-review 2026-09-28: a restore took whatsnew_seen_version from the
    backup, so the update banner (and its one-time trial line) showed again
    although nothing new had been installed."""
    k = ss.trial_state_kept
    assert k({"whatsnew_seen_version": "0.38.89"}, {"whatsnew_seen_version": "0.38.80"})["whatsnew_seen_version"] == "0.38.89"
    assert k({"whatsnew_seen_version": "0.38.9"}, {"whatsnew_seen_version": "0.38.100"})["whatsnew_seen_version"] == "0.38.100"
    assert k({"whatsnew_seen_version": "0.38.89"}, {})["whatsnew_seen_version"] == "0.38.89"
    assert "whatsnew_seen_version" not in k({"whatsnew_seen_version": "garbage"}, {"whatsnew_seen_version": None})


class _FakeStore:
    saved: dict = {}

    def __init__(self, hass, version, key):
        self._key = key

    async def async_load(self):
        return None

    async def async_save(self, data):
        _FakeStore.saved[self._key] = data

    async def async_remove(self):
        _FakeStore.saved.pop(self._key, None)


def _run(coro):
    import asyncio
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_factory_reset_keeps_the_trial_answer_and_first_sighting(monkeypatch) -> None:
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    from tests.test_telemetry import _hass
    _FakeStore.saved = {}
    monkeypatch.setattr(_hs, "Store", _FakeStore)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data.update({"trial_nudge_done": True, "first_seen_ts": 1_700_000_000.0,
                                               "quiet_mode": True})
    _run(ws_factory_reset(h, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    after = h.data[DOMAIN][DATA_SETTINGS].data
    assert after["quiet_mode"] is False, "the reset did not run"
    assert after["trial_nudge_done"] is True and after["first_seen_ts"] == 1_700_000_000.0, after
    saved = _FakeStore.saved[SETTINGS_STORE_KEY]
    assert saved["trial_nudge_done"] is True and saved["first_seen_ts"] == 1_700_000_000.0


@pytest.mark.parametrize("live,in_backup,done,first", [
    ({"trial_nudge_done": True, "first_seen_ts": 2_000.0}, {"trial_nudge_done": False, "first_seen_ts": 1_000.0},
     True, 1_000.0),
    ({"trial_nudge_done": False, "first_seen_ts": 5_000.0}, {"trial_nudge_done": True, "first_seen_ts": 0},
     True, 5_000.0),
])
def test_a_restore_keeps_the_trial_answer_and_the_earliest_sighting(monkeypatch, live, in_backup, done, first) -> None:
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha import ws_backup
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    from tests.test_telemetry import _hass
    _FakeStore.saved = {}
    monkeypatch.setattr(_hs, "Store", _FakeStore)
    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00", "version": "0.38.80",
                       "note": "", "map_images": {},
                       "stores": {SETTINGS_STORE_KEY: {"quiet_mode": True, **in_backup}}}]}

    async def _load_backups(_hass_):
        return bk

    monkeypatch.setattr(ws_backup, "_load_backups", _load_backups)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data.update(live)
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 1, "backup_id": "bk1",
                                                              "store_keys": [SETTINGS_STORE_KEY]}))
    after = h.data[DOMAIN][DATA_SETTINGS].data
    assert after["quiet_mode"] is True, "the restore did not run"
    assert after["trial_nudge_done"] is done and after["first_seen_ts"] == first, after
    assert _FakeStore.saved[SETTINGS_STORE_KEY]["trial_nudge_done"] is done
