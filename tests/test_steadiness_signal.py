# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The opt-in report's first measure of positioning quality (0.38.133).

PresenceCoordinator._note_steadiness, per poll: identified objects only, the
share with no room, receivers hearing each within 30 s, one pos_chg per room
change (room to another room; losing the room is not a change).
"""

from __future__ import annotations

from types import SimpleNamespace

from custom_components.padspan_ha import presence_coordinator as PC


def test_steadiness_counts_the_house_not_the_street(monkeypatch):
    got: list[tuple[str, float]] = []
    monkeypatch.setattr(PC, "record_duration", lambda h, m, v: got.append((m, v)))
    monkeypatch.setattr(PC, "_telemetry_on", lambda h: True)
    me = SimpleNamespace(hass=None, is_identified_object=lambda k: k.startswith("mine"))
    poll = lambda rooms: PC.PresenceCoordinator._note_steadiness(me, {
        "mine1": {"room": rooms[0], "sources": [{"age_s": 2}, {"age_s": 5}, {"age_s": 90}]},
        "mine2": {"room": rooms[1], "sources": [{"age_s": 1}]},
        "street": {"room": "Kitchen", "sources": [{"age_s": 1}] * 9},
    })
    poll(("Kitchen", "Hall"))
    assert got == [("pos_n", 2.0), ("pos_unk", 0.0), ("pos_heard", 1.5)]
    got.clear()
    poll(("Office", ""))            # one real change; mine2 lost its room
    assert got == [("pos_chg", 1.0), ("pos_n", 2.0), ("pos_unk", 50.0), ("pos_heard", 1.5)]
    got.clear()
    poll(("Office", "Hall"))        # mine2 back in Hall after unknown: no change
    assert ("pos_chg", 1.0) not in got


def test_nothing_is_walked_while_the_report_is_off(monkeypatch):
    got = []
    monkeypatch.setattr(PC, "record_duration", lambda h, m, v: got.append(m))
    monkeypatch.setattr(PC, "_telemetry_on", lambda h: False)
    me = SimpleNamespace(hass=None, is_identified_object=lambda k: True)
    PC.PresenceCoordinator._note_steadiness(me, {"a": {"room": "Kitchen"}})
    assert got == [] and not hasattr(me, "_steady_rooms")
