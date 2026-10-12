# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""MQTT publish (Settings: mqtt_publish_enabled): padspan/devices/<label>/...

The label went into the topic with only spaces replaced. "#" and "+" are
wildcards a publish topic may not contain, so a label like "Tag #2" made the
publish raise — and the try wrapped the whole loop, so every device after it
stopped publishing, every poll, logged only at debug. "/" split a label into
topic levels.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator, mqtt_topic_slug


def test_topics_people_already_use_do_not_move():
    assert mqtt_topic_slug("Garry's Keys") == "garry's_keys"
    assert mqtt_topic_slug("Ölfass") == "ölfass"
    assert mqtt_topic_slug("Car-1") == "car-1"


def test_characters_a_topic_cannot_carry_are_replaced():
    for label in ("Tag #2", "Dog + Cat", "Bag/Left"):
        slug = mqtt_topic_slug(label)
        assert not any(c in slug for c in "#+/"), slug


@pytest.mark.asyncio
async def test_one_failing_device_does_not_stop_the_rest(monkeypatch):
    hass = MagicMock()
    st = MagicMock()
    st.data = {"mqtt_publish_enabled": True}
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    coord = PresenceCoordinator(hass)
    sent = []

    async def _publish(h, topic, payload, retain=False):
        if topic.startswith("padspan/devices/first/"):
            raise ValueError("broker said no")
        sent.append(topic)
    mod = types.ModuleType("homeassistant.components.mqtt")
    mod.async_publish = _publish
    monkeypatch.setitem(sys.modules, "homeassistant.components.mqtt", mod)
    result = {"a": {"user_label": "First", "room": "Hall"}, "b": {"user_label": "Tag #2", "room": "Den"}}
    await coord._async_mqtt_publish(result)
    assert "padspan/devices/tag__2/state" in sent and "padspan/devices/tag__2/area" in sent
