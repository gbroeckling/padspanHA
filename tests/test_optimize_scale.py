# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Optimize for scale (0.38.178, off by default): several wall screens.

A real house's snapshot was 2.2 MB: 1,108 objects, nine of them anyone's,
and 1.1 MB of raw advertisements. Each screen fetched all of it every 5 s."""

from __future__ import annotations

from types import SimpleNamespace

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN


def _snap():
    objs = [{"kind": "ble", "address": f"AA:00:00:00:00:{i:02X}", "key": f"ble:aa:{i}"} for i in range(50)]
    objs += [{"kind": "ble", "address": "BB:01", "identified": True},
             {"kind": "ble", "address": "BB:02", "user_label": "Keys"},
             {"kind": "ble", "address": "BB:03", "room": "Kitchen"},
             {"kind": "ble", "address": "CC:44:55:66:77:88"},          # followed
             {"kind": "ibeacon", "address": "DD:01"},
             {"kind": "entity", "entity_id": "device_tracker.phone"}]
    return {"objects": {"list": objs, "summary": {"total": 56, "unidentified": 51}},
            "ble": {"advertisements": [{"a": 1}] * 300, "radios": [{"source": "r1"}], "diag": {"x": 1}},
            "rooms": {"Kitchen": {}}}


def test_the_slim_snapshot_keeps_what_a_screen_draws_and_the_counts():
    full = _snap()
    out = SB.slim_snapshot(full, {"CC:44:55:66:77:88"})
    kept = {o.get("address") or o.get("entity_id") for o in out["objects"]["list"]}
    assert kept == {"BB:01", "BB:02", "BB:03", "CC:44:55:66:77:88", "DD:01", "device_tracker.phone"}
    assert out["objects"]["summary"] == {"total": 56, "unidentified": 51}, "counts untouched"
    assert out["ble"]["advertisements"] == [] and out["ble"]["radios"] == [{"source": "r1"}]
    assert out["slim"] == {"objects_kept": 6, "objects_total": 56}
    assert out["rooms"] == {"Kitchen": {}}
    # The shared, cached snapshot is never changed.
    assert len(full["objects"]["list"]) == 56 and len(full["ble"]["advertisements"]) == 300 and "slim" not in full


def _hass(on: bool):
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"optimize_for_scale": on})}})


def test_polls_share_a_build_longer_only_with_the_setting_on():
    assert SB.snapshot_ttl_s(_hass(False)) == SB._SNAPSHOT_CACHE_TTL_S == 2.0
    assert SB.snapshot_ttl_s(_hass(True)) == SB.SCALE_SNAPSHOT_TTL_S == 4.5
    assert SB.snapshot_ttl_s(SimpleNamespace(data={})) == 2.0


def test_the_panel_asks_for_slim_only_on_the_overview_and_never_while_hidden():
    from pathlib import Path
    www = Path(SB.__file__).resolve().parent / "www" / "padspan-ha"
    panel = (www / "panel.js").read_text(encoding="utf-8")
    assert 'this.state.settings.optimize_for_scale) && this.state.view === "overview"' in panel
    assert "this.state.live.snapshot.slim" in panel, "leaving the Overview fetches the whole snapshot"
    assert 'optimize_for_scale && document.visibilityState === "hidden") return;' in panel
    atlas = (www / "lights_panel.js").read_text(encoding="utf-8")
    assert 'slim:true' in atlas and 'this.state._optimizeScale && document.visibilityState === "hidden"' in atlas


def test_the_setting_is_off_by_default_and_reported_only_when_on():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
    from custom_components.padspan_ha import telemetry as T
    assert DEFAULT_SETTINGS["optimize_for_scale"] is False
    assert T._FEATURE_ON_ONLY["optimize_for_scale"] == "scale"
