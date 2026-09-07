# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The recorder-health check in ws_fabric_health's Phase 4.

Garry, 2026-09-07: "How about a padspan recorder [health check] as well so
this is consistent?" — after a real incident where HA's own recorder went
silently comatose for five days (thread alive, queue draining, but zero rows
landing in the database) with nothing anywhere warning about it. There is no
entity-agnostic "is the DB still being written to" signal in HA's public
API, so this cross-checks whichever entities changed most recently
system-wide against their own persisted history.

These tests monkeypatch the SAME stub module attributes conftest.py
installs (homeassistant.helpers.recorder.get_instance,
homeassistant.components.recorder.history.get_last_state_changes) — the
production code imports both names locally, inside the function, on every
call, so a monkeypatch on the stub module is always seen without needing to
patch anything in ws_fabric itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tests.conftest import FakeRecorderInstance

_NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


def _state(entity_id: str, last_updated: datetime):
    return SimpleNamespace(entity_id=entity_id, last_updated=last_updated)


def _hass_with_states(states: list) -> MagicMock:
    hass = MagicMock()
    hass.data = {}
    hass.states.async_all = MagicMock(return_value=states)
    return hass


async def _run(hass) -> dict:
    from custom_components.padspan_ha.ws_fabric import ws_fabric_health
    conn = MagicMock()
    await ws_fabric_health(hass, conn, {"id": 1})
    return conn.send_result.call_args[0][1]


def _recorder_check(res: dict) -> dict:
    return next(c for c in res["checks"] if c["name"] == "Recorder Writing History")


def _thread_check(res: dict) -> dict:
    return next(c for c in res["checks"] if c["name"] == "Recorder Thread")


@pytest.mark.asyncio
async def test_healthy_recorder_reports_ok_with_a_small_lag(monkeypatch):
    """The freshest live entity has a recent DB entry — a few seconds
    behind, well under the 15-minute tolerance — must report healthy."""
    import homeassistant.helpers.recorder as rec_helpers
    import homeassistant.components.recorder.history as rec_history

    live_ts = _NOW
    db_ts = _NOW - timedelta(seconds=8)
    monkeypatch.setattr(rec_helpers, "get_instance", lambda hass: FakeRecorderInstance())
    monkeypatch.setattr(rec_history, "get_last_state_changes",
                         lambda hass, n, eid: {eid: [_state(eid, db_ts)]})
    monkeypatch.setattr("homeassistant.util.dt.utcnow", lambda: _NOW)

    hass = _hass_with_states([_state("sensor.freshest", live_ts)])
    res = await _run(hass)

    check = _recorder_check(res)
    assert check["ok"] is True, check
    assert check["value"] == "8s behind", check


@pytest.mark.asyncio
async def test_stalled_recorder_reports_unhealthy_with_the_real_lag(monkeypatch):
    """A live entity changed seconds ago, but its last DB-persisted change
    is hours old — the exact real-world shape of the incident this check
    exists to catch — must report unhealthy with the actual lag surfaced."""
    import homeassistant.helpers.recorder as rec_helpers
    import homeassistant.components.recorder.history as rec_history

    db_ts = _NOW - timedelta(hours=5)
    monkeypatch.setattr(rec_helpers, "get_instance", lambda hass: FakeRecorderInstance())
    monkeypatch.setattr(rec_history, "get_last_state_changes",
                         lambda hass, n, eid: {eid: [_state(eid, db_ts)]})
    monkeypatch.setattr("homeassistant.util.dt.utcnow", lambda: _NOW)

    hass = _hass_with_states([_state("binary_sensor.stalled", _NOW)])
    res = await _run(hass)

    check = _recorder_check(res)
    assert check["ok"] is False, check
    assert check["value"] == f"{5*3600}s behind", check
    assert "binary_sensor.stalled" in check["detail"]
    assert res["summary"]["healthy"] is False


@pytest.mark.asyncio
async def test_falls_through_to_the_next_candidate_when_one_is_excluded(monkeypatch):
    """A recorder-excluded entity (no DB history at all, by design — not a
    failure) must not be mistaken for a stalled recorder: the check must
    keep sampling until it finds a candidate that DOES have history, and
    judge health from that one instead."""
    import homeassistant.helpers.recorder as rec_helpers
    import homeassistant.components.recorder.history as rec_history

    db_ts = _NOW - timedelta(seconds=3)

    def _fake_history(hass, n, eid):
        if eid == "sensor.excluded_from_recorder":
            return {}  # this entity has no history at all, by design
        return {eid: [_state(eid, db_ts)]}

    monkeypatch.setattr(rec_helpers, "get_instance", lambda hass: FakeRecorderInstance())
    monkeypatch.setattr(rec_history, "get_last_state_changes", _fake_history)
    monkeypatch.setattr("homeassistant.util.dt.utcnow", lambda: _NOW)

    hass = _hass_with_states([
        _state("sensor.excluded_from_recorder", _NOW),
        _state("sensor.recorded_fine", _NOW - timedelta(seconds=1)),
    ])
    res = await _run(hass)

    check = _recorder_check(res)
    assert check["ok"] is True, check
    assert "sensor.recorded_fine" in check["detail"], (
        "must have fallen through past the excluded entity to one with real history", check,
    )


@pytest.mark.asyncio
async def test_every_sampled_entity_lacking_history_reports_unknown_not_healthy(monkeypatch):
    """If NONE of the sampled candidates have any recorder history at all,
    the check cannot tell whether the recorder is healthy — it must say so
    honestly (ok=False, value="unknown"), never default to a false "ok"."""
    import homeassistant.helpers.recorder as rec_helpers
    import homeassistant.components.recorder.history as rec_history

    monkeypatch.setattr(rec_helpers, "get_instance", lambda hass: FakeRecorderInstance())
    monkeypatch.setattr(rec_history, "get_last_state_changes", lambda hass, n, eid: {})
    monkeypatch.setattr("homeassistant.util.dt.utcnow", lambda: _NOW)

    hass = _hass_with_states([_state("sensor.only_one", _NOW)])
    res = await _run(hass)

    check = _recorder_check(res)
    assert check["ok"] is False and check["value"] == "unknown", check


@pytest.mark.asyncio
async def test_recorder_thread_check_reflects_recording_and_migration_state(monkeypatch):
    """A stopped recorder thread, or one mid-schema-migration, must fail
    the separate "Recorder Thread" check regardless of history freshness."""
    import homeassistant.helpers.recorder as rec_helpers
    import homeassistant.components.recorder.history as rec_history

    monkeypatch.setattr(
        rec_helpers, "get_instance",
        lambda hass: FakeRecorderInstance(recording=False, backlog=42, migration_in_progress=True),
    )
    monkeypatch.setattr(rec_history, "get_last_state_changes",
                         lambda hass, n, eid: {eid: [_state(eid, _NOW)]})
    monkeypatch.setattr("homeassistant.util.dt.utcnow", lambda: _NOW)

    hass = _hass_with_states([_state("sensor.x", _NOW)])
    res = await _run(hass)

    check = _thread_check(res)
    assert check["ok"] is False, check
    assert check["value"] == "stopped", check
    assert "migration" in check["detail"].lower(), check


@pytest.mark.asyncio
async def test_recorder_check_never_crashes_the_whole_health_endpoint(monkeypatch):
    """A recorder API surprise (an exception from get_instance, say — the
    same defensive posture as every OTHER phase in this function, all of
    which wrap their own checks in try/except) must degrade to one failed
    check, never take down fabric_health's whole response."""
    import homeassistant.helpers.recorder as rec_helpers

    def _boom(hass):
        raise RuntimeError("recorder not ready")

    monkeypatch.setattr(rec_helpers, "get_instance", _boom)

    hass = _hass_with_states([_state("sensor.x", _NOW)])
    res = await _run(hass)  # must not raise

    check = _recorder_check(res)
    assert check["ok"] is False and check["value"] == "error", check
    assert "checks" in res and "summary" in res
