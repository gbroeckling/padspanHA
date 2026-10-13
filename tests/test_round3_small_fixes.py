# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Round 3 small fixes (2026-10-12): Traceback distance, Forensics count and
search race, scene rules, dump_devices, deleting a PadSpan device."""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path
from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _run(coro):
    return asyncio.run(coro)


def test_distance_travelled_reads_the_recorded_metres():
    """Frames carry x_m/y_m; it read x/y/m, so every step fell back to the
    room centre and a day in one open-plan room showed 0 m."""
    src = (_VIEWS / "traceback.js").read_text(encoding="utf-8")
    assert "if (o.x_m != null && o.y_m != null) pos = [o.x_m, o.y_m];" in src


def test_forensics_more_count_uses_the_true_total():
    src = (_VIEWS / "forensics.js").read_text(encoding="utf-8")
    assert "const total = Number(r.session_count) || sess.length;" in src
    assert "earlier session(s) in this window not included" in src


def test_forensics_search_iterates_a_copy():
    """The query ran in the executor over the live dict the 60 s tick adds
    to and deletes from: "changed size during iteration", Search failed."""
    from custom_components.padspan_ha.forensics_store import ForensicsStore
    from custom_components.padspan_ha import ws_forensics
    assert "list(fs.addrs.items())" in inspect.getsource(ws_forensics)
    fs = ForensicsStore.__new__(ForensicsStore)
    fs.addrs = {}
    assert fs.query(0, 10, 500, [("AA", {"sessions": [[1, 5, -60, ["s1"]]], "name": ""})]) is not None


def test_a_scene_turn_off_rule_is_refused():
    """HA has no scene.turn_off: the rule saved fine and never did anything."""
    from custom_components.padspan_ha import ws_settings as WS
    from tests.test_house3d_store import _house as _h
    h = _h(on=False)
    st = h.data[DOMAIN][DATA_SETTINGS]

    async def _set(**kw):
        st.data.update(kw)
    st.async_set = _set
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    rules = [{"id": "a", "trigger": "arrive", "device_key": "k", "device_label": "Keys",
              "action": "turn_off", "entity_id": "scene.movie"},
             {"id": "b", "trigger": "arrive", "device_key": "k", "device_label": "Keys",
              "action": "turn_on", "entity_id": "scene.movie"}]
    _run(WS.ws_settings_set(h, conn, {"id": 1, "type": "padspan_ha/settings_set", "padspan_automations": rules}))
    assert [r["id"] for r in st.data["padspan_automations"]] == ["b"]
    assert 'ent.startsWith("scene.") && actionSel.value === "turn_off"' in (_VIEWS / "settings.js").read_text(encoding="utf-8")


def test_dump_devices_honours_notify_false_and_has_no_target():
    import custom_components.padspan_ha as pkg
    src = inspect.getsource(pkg)
    assert 'if not call.data.get("notify", True):' in src
    yaml = (Path(pkg.__file__).parent / "services.yaml").read_text(encoding="utf-8")
    block = yaml[yaml.index("dump_devices:"):yaml.index("wled_on:")]
    assert "target:" not in block


def test_a_padspan_device_can_be_deleted_from_its_page():
    import custom_components.padspan_ha as pkg
    assert asyncio.run(pkg.async_remove_config_entry_device(MagicMock(), MagicMock(), MagicMock())) is True
