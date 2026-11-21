"""A tier override and a Pro-only key in one settings message.

The Pro-only keys (Forensics recording, who "you" are for Locate) used to be
judged by the tier stored before the message: sent with an override that
lowers the tier, the Pro key went on the first time and off the second, and
an override lifted in the same message left the key off until it was sent
again. They are judged by the tier the message leaves.
"""

from __future__ import annotations

import pytest

from tests import golden_settings as gs
from tests.test_settings_refusals import send

_PHONE = "C0:FF:EE:00:00:01"
PRO_KEYS = {"forensics_enabled": (True, False), "locate_self_key": (_PHONE, "")}


def _twice(message: dict, start: dict) -> tuple[dict, dict]:
    first = send(message, start=start)
    assert first["error"] is None, first["error"]
    second = send(message, start=first["data"])
    assert second["error"] is None, second["error"]
    return first["data"], second["data"]


@pytest.mark.parametrize("key", sorted(PRO_KEYS))
@pytest.mark.parametrize("override", ["free", "bright", "pro", ""])
def test_the_same_message_twice_gives_the_same_result(key: str, override: str) -> None:
    on, _off = PRO_KEYS[key]
    a, b = _twice({"license_tier_override": override, key: on}, gs._PRO)
    assert a[key] == b[key] and a["license_tier_override"] == b["license_tier_override"] == override


@pytest.mark.parametrize("key", sorted(PRO_KEYS))
@pytest.mark.parametrize("override", ["free", "bright"])
def test_lowering_the_tier_and_a_pro_key_in_one_message_leaves_the_key_off(key: str, override: str) -> None:
    on, off = PRO_KEYS[key]
    got = send({"license_tier_override": override, key: on}, start=gs._PRO)
    assert got["error"] is None and got["data"][key] == off and got["data"]["license_tier_override"] == override


@pytest.mark.parametrize("key", sorted(PRO_KEYS))
def test_lifting_the_override_and_a_pro_key_in_one_message_turns_the_key_on(key: str) -> None:
    on, _off = PRO_KEYS[key]
    got = send({"license_tier_override": "", key: on}, start={**gs._PRO, "license_tier_override": "free"})
    assert got["error"] is None and got["data"][key] == on


@pytest.mark.parametrize("key", sorted(PRO_KEYS))
def test_an_override_never_raises_the_tier_past_the_licence(key: str) -> None:
    on, off = PRO_KEYS[key]
    got = send({"license_tier_override": "pro", key: on}, start={})
    assert got["error"] is None and got["data"][key] == off


@pytest.mark.parametrize("key", sorted(PRO_KEYS))
def test_without_an_override_in_the_message_the_stored_tier_decides(key: str) -> None:
    on, off = PRO_KEYS[key]
    assert send({key: on}, start=gs._PRO)["data"][key] == on
    assert send({key: on}, start={**gs._PRO, "license_tier_override": "free"})["data"][key] == off
