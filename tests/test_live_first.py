# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A new install opens on its own house, not the demo one.

  1. A brand-new install is marked to switch (onboarding["live_first"]
     "pending") and starts in Sample until Home Assistant reports a
     Bluetooth scanner; every install from before keeps its mode.
  2. The first live snapshot that lists a scanner turns it to Live, once.
  3. Someone who picks a mode themselves first is never overridden.
"""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.padspan_ha import onboarding as onb
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.build_info import EDITION
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_onboarding_proxy_health import _load
from tests.test_telemetry import _hass as _report_hass

_RADIO = {"source": "AA:BB:CC:DD:EE:01", "name": "Kitchen proxy", "area_name": "Kitchen"}


def _run(coro):
    return asyncio.run(coro)


def _house(ob, mode="sample"):
    st = SimpleNamespace(data={"onboarding": ob, "data_mode": mode, "followed_addrs": []})

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    tasks = []
    h = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st, "calibration": SimpleNamespace(data={"points": []})}},
                        async_create_task=lambda c: tasks.append(c))
    return h, st, tasks


def _snap(*radios):
    return {"ble": {"radios": list(radios)}, "objects": {"list": []}}


# ═══ 1. who is marked ════════════════════════════════════════════════════════

def test_the_default_is_still_sample():
    # Changing the default would change every factory reset and lost settings
    # file too; only a brand-new install is marked.
    assert DEFAULT_SETTINGS["data_mode"] == "sample"


def test_a_brand_new_install_is_marked_and_starts_in_sample(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    data, saved = _load(None, storage)
    assert data["data_mode"] == "sample"
    if EDITION == "bright":        # the Atlas alone: never marked (test_bright_is_never_marked)
        assert "live_first" not in data["onboarding"]
        return
    assert data["onboarding"]["live_first"] == "pending"
    assert saved["onboarding"]["live_first"] == "pending"


def test_an_existing_install_is_never_marked(tmp_path):
    storage = tmp_path / ".storage"
    storage.mkdir()
    for loaded in ({"data_mode": "sample"}, {"data_mode": "live"}, {}):
        data, _ = _load(dict(loaded), storage)
        assert "live_first" not in data["onboarding"], loaded
        assert data["data_mode"] == loaded.get("data_mode", "sample")


# ═══ 2. the switch ═══════════════════════════════════════════════════════════

def test_hears_a_scanner():
    assert onb.hears_a_scanner(_snap(_RADIO))
    assert not onb.hears_a_scanner(_snap())
    assert not onb.hears_a_scanner({"objects": {}})
    assert not onb.hears_a_scanner({"ble": {"radios": [{"source": ""}, None, "x"]}})
    assert not onb.hears_a_scanner(None)


def test_no_scanner_yet_stays_in_sample_and_waits():
    h, st, tasks = _house({"setup_ts": time.time(), "live_first": "pending"})
    onb.note_snapshot(h, _snap())
    assert st.data["data_mode"] == "sample" and st.data["onboarding"]["live_first"] == "pending"
    assert not tasks


def test_the_first_scanner_turns_it_live_once():
    h, st, tasks = _house({"setup_ts": time.time(), "live_first": "pending"})
    onb.note_snapshot(h, _snap(_RADIO))
    assert st.data["data_mode"] == "live" and st.data["onboarding"]["live_first"] == "switched"
    assert len(tasks) == 1
    _run(tasks[0])
    assert st.data["data_mode"] == "live" and st.data["onboarding"]["setup_ts"]
    # Later builds change nothing, even after someone goes back to Sample.
    st.data["data_mode"] = "sample"
    onb.note_snapshot(h, _snap(_RADIO))
    assert st.data["data_mode"] == "sample" and len(tasks) == 1


def test_the_first_room_is_still_measured_in_the_same_build():
    h, st, tasks = _house({"setup_ts": time.time() - 60, "live_first": "pending"})
    snap = _snap(_RADIO)
    snap["objects"]["list"].append({"address": "CC", "user_label": "Keys", "room": "Hall"})
    onb.note_snapshot(h, snap)
    for t in tasks:
        _run(t)
    assert st.data["onboarding"]["live_first"] == "switched"
    assert st.data["onboarding"]["first_room"] == "lt15m"


def test_an_install_from_before_is_never_switched():
    for ob in ({}, {"setup_ts": time.time()}, {"setup_ts": time.time(), "live_first": "switched"}):
        h, st, tasks = _house(dict(ob))
        onb.note_snapshot(h, _snap(_RADIO))
        for t in tasks:
            _run(t)
        assert st.data["data_mode"] == "sample", ob


# ═══ 3. a choice wins ════════════════════════════════════════════════════════

def _set_mode(h, mode):
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "data_mode": mode}))
    conn.send_error.assert_not_called()


def test_choosing_a_mode_first_is_never_overridden():
    h = _report_hass()
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data["onboarding"] = {"setup_ts": time.time(), "live_first": "pending"}
    _set_mode(h, "sample")
    assert st.data["data_mode"] == "sample"
    assert st.data["onboarding"]["live_first"] == "chosen"
    tasks = []
    h.async_create_task = lambda c: tasks.append(c)
    onb.note_snapshot(h, _snap(_RADIO))
    for t in tasks:          # this house's other first steps may be saved; never the mode
        _run(t)
    assert st.data["data_mode"] == "sample" and st.data["onboarding"]["live_first"] == "chosen"


def test_a_mode_set_after_the_switch_leaves_the_record_alone():
    h = _report_hass()
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data["onboarding"] = {"setup_ts": 1.0, "live_first": "switched"}
    _set_mode(h, "sample")
    assert st.data["data_mode"] == "sample" and st.data["onboarding"]["live_first"] == "switched"


def test_an_install_from_before_choosing_a_mode_gets_no_record():
    h = _report_hass()
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data.pop("onboarding", None)
    _set_mode(h, "live")
    assert st.data["data_mode"] == "live" and "onboarding" not in st.data


# ═══ 4. after review ═════════════════════════════════════════════════════════

def test_bright_is_never_marked(tmp_path, monkeypatch):
    from custom_components.padspan_ha import settings_store as ss
    monkeypatch.setattr(ss, "EDITION", "bright")
    storage = tmp_path / ".storage"
    storage.mkdir()
    data, _ = _load(None, storage)
    assert "live_first" not in data["onboarding"] and data["data_mode"] == "sample"


def test_a_restore_never_brings_pending_back():
    from custom_components.padspan_ha.settings_store import live_first_kept
    pending = {"onboarding": {"setup_ts": 1.0, "live_first": "pending"}}
    # A backup taken while pending, restored on an install from before: no switch.
    assert live_first_kept({}, pending) == {"onboarding": {"setup_ts": 1.0}}
    # ... or on one that has decided: its answer stays.
    for mine in ("switched", "chosen"):
        out = live_first_kept({"onboarding": {"live_first": mine}}, pending)
        assert out["onboarding"]["live_first"] == mine and out["onboarding"]["setup_ts"] == 1.0
    # A new install (pending) restoring an older backup: the backup's mode stands.
    assert live_first_kept(pending, {"onboarding": {}, "data_mode": "sample"}) == {"onboarding": {}}
    assert live_first_kept(pending, {"data_mode": "sample"}) == {}
    # A decided backup keeps its own word where this install has none.
    assert live_first_kept({}, {"onboarding": {"live_first": "chosen"}}) == {"onboarding": {"live_first": "chosen"}}


def test_restore_and_bright_import_apply_it():
    from pathlib import Path
    cc = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    assert "data.update(live_first_kept(store_obj.data or {}, data))" in (cc / "ws_backup.py").read_text(encoding="utf-8")
    assert "data.update(live_first_kept(live_settings, data))" in (cc / "bright_import.py").read_text(encoding="utf-8")


def test_a_mode_picked_before_the_save_runs_is_kept():
    """On a Home Assistant whose tasks don't start at once, the user can pick
    Sample between the switch and its save: the save writes what is current."""
    h, st, tasks = _house({"setup_ts": time.time(), "live_first": "pending"})
    onb.note_snapshot(h, _snap(_RADIO))
    st.data["data_mode"] = "sample"            # someone's choice, before the task runs
    for t in tasks:
        _run(t)
    assert st.data["data_mode"] == "sample"
