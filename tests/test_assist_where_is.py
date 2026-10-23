# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Assist's "which room is Alice in" — the PadSpanWhereIs intent.

It answers from the presence coordinator, writes nothing, and is inert by
default: no sentence that names it ships with PadSpan, nothing installs one,
and there is no llm.py to hand it to an LLM agent. The user turns it on by
adding the custom sentences in docs/GETTING_STARTED.md.
"""

from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha.const import DOMAIN
from custom_components.padspan_ha.intents import (
    INTENT_WHERE_IS,
    async_setup_intents,
    find_device,
    where_is_answer,
)

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "custom_components" / "padspan_ha"
T = 300.0

DATA = {
    "k1": {"kind": "ble", "user_label": "Alice", "age_s": 4, "room": "Kitchen", "room_confidence": 0.9},
    "k2": {"kind": "private_ble", "user_label": "Bob's Phone", "age_s": 30, "room": "Office", "room_confidence": 0.3},
    "k3": {"kind": "ble", "user_label": "Bob Watch", "age_s": 2, "room": "Garage", "room_confidence": 0.8},
    "k4": {"kind": "ble", "user_label": "Carol", "age_s": 3600, "room": "Den"},
    "k5": {"kind": "ble", "user_label": "Dave", "age_s": 5},
    "k6": {"kind": "ble", "age_s": 1, "room": "Hall"},
}


def test_the_label_itself_answers_with_its_room() -> None:
    assert where_is_answer(DATA, "Alice", T) == "Alice is in the Kitchen."
    assert where_is_answer(DATA, "  the alice ", T) == "Alice is in the Kitchen."


def test_a_label_starting_with_the_name_answers_freshest_first() -> None:
    assert find_device(DATA, "Bob")["user_label"] == "Bob Watch"
    assert where_is_answer(DATA, "bob's phone", T) == "Bob's Phone is probably in the Office."


def test_away_unknown_room_and_nobody() -> None:
    assert where_is_answer(DATA, "Carol", T) == "Carol is away."
    assert where_is_answer(DATA, "Dave", T) == "I don't know which room Dave is in right now."
    assert where_is_answer(DATA, "Eve", T) == "I don't know anyone called Eve."
    assert where_is_answer(None, "Alice", T) == "I don't know anyone called Alice."
    assert find_device(DATA, "") is None


def test_a_name_never_matches_inside_another_word() -> None:
    assert find_device(DATA, "Al") is None
    assert find_device(DATA, "Bo") is None


def _fake_intent_module() -> ModuleType:
    mod = ModuleType("homeassistant.helpers.intent")
    mod.registered = {}

    class IntentHandler:
        intent_type = ""

    class Intent:  # noqa: D401 - annotation only
        pass

    class IntentResponse:
        pass

    mod.IntentHandler = IntentHandler
    mod.Intent = Intent
    mod.IntentResponse = IntentResponse
    mod.async_register = lambda hass, h: mod.registered.__setitem__(h.intent_type, h)
    return mod


def test_the_handler_speaks_the_room_and_writes_nothing(monkeypatch) -> None:
    mod = _fake_intent_module()
    helpers = sys.modules["homeassistant.helpers"]
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.intent", mod)
    monkeypatch.setattr(helpers, "intent", mod, raising=False)

    data = copy.deepcopy(DATA)
    coord = MagicMock()
    coord.data = data
    hass = MagicMock()
    hass.data = {DOMAIN: {"presence_coordinator": coord}}
    async_setup_intents(hass)
    handler = mod.registered[INTENT_WHERE_IS]

    response = MagicMock()
    intent_obj = MagicMock()
    intent_obj.hass = hass
    intent_obj.slots = {"padspan_person": {"value": "Alice", "text": "Alice"}}
    intent_obj.create_response.return_value = response
    assert asyncio.run(handler.async_handle(intent_obj)) is response
    response.async_set_speech.assert_called_once_with("Alice is in the Kitchen.")
    assert data == DATA
    coord.async_request_refresh.assert_not_called()


def test_off_by_default_nothing_ships_or_installs_sentences() -> None:
    assert not (PKG / "llm.py").exists(), "an llm.py would give the intent to LLM agents by default"
    assert not list(PKG.rglob("custom_sentences*"))
    for path in PKG.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "custom_sentences/" not in text or path.name == "intents.py", path
    intents_src = (PKG / "intents.py").read_text(encoding="utf-8")
    for write in ("async_save", "async_delay_save", "open(", "hass.states.async_set", "services.async_call"):
        assert write not in intents_src, write


def test_registration_cannot_break_startup() -> None:
    src = (PKG / "__init__.py").read_text(encoding="utf-8")
    at = src.index("async_setup_intents(hass)")
    assert "try:" in src[at - 200:at]
    assert "except Exception" in src[at:at + 200]


def test_docs_give_the_sentences_and_the_built_in_finding() -> None:
    path = ROOT / "docs" / "GETTING_STARTED.md"
    if not path.exists():
        pytest.skip("the Bright derivation carries no docs/")
    doc = path.read_text(encoding="utf-8")
    assert "## Ask Assist where someone is" in doc
    assert "PadSpanWhereIs:" in doc and "wildcard: true" in doc
    assert "name_where" in doc and "Expose" in doc


def test_llm_agents_are_not_given_it_and_its_slot_is_described(monkeypatch) -> None:
    """Home Assistant before 2026.8 offered LLM agents every registered intent
    whose platforms were None or matched an exposed entity's domain
    (helpers/llm.py AssistAPI). The integration's own domain is never an
    entity's domain, so it stays off; the default agent's sentences call
    intent.async_handle, which does not look at platforms."""
    mod = _fake_intent_module()
    helpers = sys.modules["homeassistant.helpers"]
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.intent", mod)
    monkeypatch.setattr(helpers, "intent", mod, raising=False)
    async_setup_intents(MagicMock())
    handler = mod.registered[INTENT_WHERE_IS]
    assert handler.platforms == {DOMAIN}
    exposed_domains = {"sensor", "device_tracker", "person", "light"}
    assert not (handler.platforms & exposed_domains)
    import voluptuous as vol
    schema = vol.Schema(handler.slot_schema)
    assert schema({"padspan_person": "Alice"}) == {"padspan_person": "Alice"}
    assert schema({}) == {}
    with pytest.raises(vol.Invalid):
        schema({"padspan_person": 3})
