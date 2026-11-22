"""What the settings command (padspan_ha/settings_set) refuses, and what a
refused message leaves behind: nothing.

Four rules, each held here in plain cases:

  A  A number that is not finite (the text "nan", "inf", "-inf") is refused
     for every key read as a number. It used to be clamped, and stored as the
     key's upper bound.
  B  A list or dict holding the wrong kind of thing is answered with an
     error. Two keys used to raise, so the caller got no answer at all.
  C  A refused message changes nothing: no setting, no counter, no label, no
     report window. A message with several keys used to act on the first and
     then refuse the second.
  D  Lists and maps of names keep names only: text, without the spaces
     around it, never empty; the ESPresense Companion's address is an http
     or https URL, or empty.

Each message goes through the command's own schema first, as Home Assistant
sends it, in the stand-in house of tests/golden_settings.py.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
import voluptuous as vol

from custom_components.padspan_ha import ws_settings as WS
from tests import golden_settings as gs

_PHONE, _TAG = "C0:FF:EE:00:00:01", "C0:FF:EE:00:00:02"
_SAVED = "settings saved to disk"


def send(message: dict[str, Any], start: dict[str, Any] | None = None, admin: bool = True) -> dict[str, Any]:
    """Send one message; what came of it: the error sent, whether it was
    answered, what was written, what else was set going (in order), and the
    settings afterwards."""
    box: dict[str, list[str]] = {"effects": []}
    with gs._watched(box):
        hass, conn, st, (written, sent) = gs._house(start or {}, admin, box["effects"])
        ok, msg = gs._through_schema(message)
        assert ok, f"the schema itself refuses {message!r}"
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(WS.ws_settings_set(hass, conn, msg))
        finally:
            loop.close()
    return {"error": sent["error"], "answered": sent["answered"], "written": written,
            "effects": list(box["effects"]), "data": st.data}


def changed_nothing(got: dict[str, Any]) -> bool:
    return bool(got["error"]) and not got["answered"] and got["written"] == [] and got["effects"] == []


def _reads_numbers(validator: Any) -> bool:
    if isinstance(validator, vol.Coerce):
        return validator.type in (int, float)
    if isinstance(validator, vol.Any):
        return any(v in (int, float) or _reads_numbers(v) for v in validator.validators)
    if isinstance(validator, vol.All):
        return _reads_numbers(validator.validators[0])     # what it takes; the rest only limit it
    return False


NUMBER_KEYS = sorted(k for k, v in gs.schema_keys().items() if _reads_numbers(v))
LIST_AND_DICT_KEYS = sorted(k for k, v in gs.schema_keys().items() if "list" in gs._kind(v) or "dict" in gs._kind(v))


# ── A: a number that is not finite ───────────────────────────────────────────

def test_the_schema_has_the_number_keys_this_test_expects() -> None:
    assert len(NUMBER_KEYS) > 40 and {"room_change_delay_s", "fabric_origin_lat", "ai_credit_month_usd",
                                      "maps_iso_focus", "health_reminder_last_ts"} <= set(NUMBER_KEYS)


@pytest.mark.parametrize("key", NUMBER_KEYS)
@pytest.mark.parametrize("text", ["nan", "inf", "-inf"])
def test_a_number_that_is_not_finite_is_refused_and_nothing_is_stored(key: str, text: str) -> None:
    ok, _msg = gs._through_schema({key: text})
    if not ok:
        return          # the schema refuses it for this key: Home Assistant answers with an error
    got = send({key: text})
    assert changed_nothing(got), f"{key}={text!r} was taken: wrote {got['written']}, error {got['error']}"
    assert got["error"][0] in ("invalid", "invalid_format")


@pytest.mark.parametrize("key", ["room_change_delay_s", "kalman_q", "overview_iso_zoom", "occupancy_cluster_threshold"])
def test_the_refusal_names_the_key(key: str) -> None:
    assert send({key: "nan"})["error"] == ["invalid", f"{key} must be a finite number"]


def test_a_finite_number_out_of_range_is_still_kept_within_it() -> None:
    assert send({"room_change_delay_s": 1e12})["written"] == [{"room_change_delay_s": 300.0}]
    assert send({"ref_power": "-65.5"})["written"] == [{"ref_power": -65.5}]
    assert send({"fabric_origin_lat": None})["written"] == [{"fabric_origin_lat": None}]
    # Text that is no number at all is each key's own to read: an empty
    # monthly credit is "none".
    assert send({"ai_credit_month_usd": ""})["written"] == [{"ai_credit_month_usd": 0}]


def test_one_number_that_is_not_finite_refuses_the_whole_message() -> None:
    got = send({"quiet_mode": True, "kalman_q": "nan"})
    assert changed_nothing(got) and got["data"]["quiet_mode"] is False


@pytest.mark.parametrize("value", ["nan", "inf", "-inf"])
def test_a_receivers_signal_adjustment_that_is_not_finite_is_refused(value: str) -> None:
    got = send({"scanner_offsets": {"AA:00:00:00:00:01": 3, "AA:00:00:00:00:02": value}})
    assert changed_nothing(got) and got["error"][0] == "invalid"


@pytest.mark.parametrize("zoom", ["nan", "inf"])
def test_a_saved_look_with_a_zoom_that_is_not_finite_is_left_out(zoom: str) -> None:
    """A malformed look never refuses the save of the others."""
    looks = [{"name": "Bad", "values": {"overview_iso_zoom": zoom}}, {"name": "Good", "values": {"overview_iso_zoom": 9}}]
    kept = WS._sanitize_showcase_presets(looks)
    assert [p["name"] for p in kept] == ["Good"] and kept[0]["values"]["overview_iso_zoom"] == 2.5


# ── B: the wrong kind of thing in a list or dict ─────────────────────────────

@pytest.mark.parametrize("inside", [{"x": 1}, ["devices"], None, 5])
def test_extra_tabs_that_are_not_names_are_refused_with_an_error(inside: Any) -> None:
    got = send({"advanced_extra_tabs": ["devices", inside]})
    assert changed_nothing(got) and got["error"][0] == "invalid_format"


def test_extra_tabs_keep_the_names_of_real_tabs() -> None:
    assert send({"advanced_extra_tabs": ["devices", "qa", "not_a_tab"]})["written"] == [
        {"advanced_extra_tabs": ["devices", "qa"]}]
    assert send({"advanced_extra_tabs": []})["written"] == [{"advanced_extra_tabs": []}]


@pytest.mark.parametrize("value", [None, "loud", "", [1], {"dB": 3}])
def test_a_receivers_signal_adjustment_that_is_no_number_is_refused_with_an_error(value: Any) -> None:
    got = send({"scanner_offsets": {"AA:00:00:00:00:01": 3, "AA:00:00:00:00:02": value}},
               start={"scanner_offsets": {"AA:00:00:00:00:01": 1.0}})
    assert changed_nothing(got) and got["error"][0] == "invalid"
    assert got["data"]["scanner_offsets"] == {"AA:00:00:00:00:01": 1.0}


def test_a_receivers_signal_adjustment_is_kept_as_a_number() -> None:
    assert send({"scanner_offsets": {"AA:00:00:00:00:01": 3, "AA:00:00:00:00:02": "-2.5"}})["written"] == [
        {"scanner_offsets": {"AA:00:00:00:00:01": 3.0, "AA:00:00:00:00:02": -2.5}}]


@pytest.mark.parametrize("key", LIST_AND_DICT_KEYS)
@pytest.mark.parametrize("value", [[{"a": 1}], {"a": [1]}, None, 5, [["a"]], [None], [5], {"a": {"b": 1}},
                                   {"a": None}, {"a": 5}, {"a": "text"}])
def test_no_list_or_dict_key_leaves_the_caller_without_an_answer(key: str, value: Any) -> None:
    ok, _msg = gs._through_schema({key: value})
    if not ok:
        return
    got = send({key: value})            # raising here is the failure
    assert got["answered"] != bool(got["error"]), f"{key}={value!r}: answered {got['answered']}, error {got['error']}"
    if got["error"]:
        assert changed_nothing(got)


# ── C: a refused message changes nothing ─────────────────────────────────────

_BAD_SOURCE = {"vacation_mode_source": "next_week"}
_BAD_BEDTIME = {"vacation_mode_bedtime": "99:99"}

# (what the first key sets going when the message is accepted, the first key,
#  the settings it starts from)
_ACTS: list[tuple[list[str], dict[str, Any], dict[str, Any]]] = [
    ([f"object state cleared: {_TAG}", f"object labelled: {_PHONE} = 'Tile'"],
     {"followed_addrs": [_PHONE]}, {"followed_addrs": [_TAG]}),
    (["report: install id made sure of", "report: usage and error windows started again", "report: run log kept"],
     {"telemetry_enabled": True}, {}),
    (["report: run log removed"], {"telemetry_enabled": False}, {"telemetry_enabled": True}),
    (["report counter: plan_build_setting:on"], {"ai_plan_build_enabled": True}, {}),
    (["report counter: ai_credit_warn:set_75"], {"ai_credit_warn_pct": 75}, {}),
    (["report counter: showcase_on", "report counter: showcase_forest_default"], {"lights_showcase": True}, {}),
]
_ACT_IDS = ["a follow", "the usage report on", "the usage report off", "build from plans",
            "the credit warning", "showcase"]
_REFUSED = [_BAD_SOURCE, _BAD_BEDTIME, {"guest_retention_days": 5}, {"vacation_mode_end_at": gs.NOW - 5},
            {"kalman_q": "nan"}, {"espresense_companion_url": "not a url"}, {"advanced_extra_tabs": [{"x": 1}]},
            {"scanner_offsets": {"AA:00:00:00:00:01": None}}]


@pytest.mark.parametrize(("does", "first", "start"), _ACTS, ids=_ACT_IDS)
def test_alone_the_key_is_accepted_and_acts_before_the_save(does: list[str], first: dict, start: dict) -> None:
    got = send(first, start)
    assert got["error"] is None and got["answered"]
    assert got["effects"][:len(does)] == does and got["effects"][len(does)] == _SAVED


@pytest.mark.parametrize(("does", "first", "start"), _ACTS, ids=_ACT_IDS)
@pytest.mark.parametrize("refused", _REFUSED, ids=[next(iter(r)) for r in _REFUSED])
def test_with_a_refused_key_beside_it_nothing_is_done(does: list[str], first: dict, start: dict, refused: dict) -> None:
    got = send({**first, **refused}, start)
    assert got["error"], "the second key should have been refused"
    assert got["effects"] == [], f"refused with {got['error']}, yet it had already: {got['effects']}"
    assert got["written"] == [] and not got["answered"]
    for key in first:
        assert got["data"].get(key) == {**gs.DEFAULT_SETTINGS, **start}.get(key)


def test_an_accepted_message_acts_in_the_order_of_its_keys_then_saves() -> None:
    got = send({"lights_showcase": True, "ai_plan_build_enabled": True, "followed_addrs": [_PHONE],
                "telemetry_enabled": True}, {"followed_addrs": [_TAG]})
    assert got["error"] is None
    assert got["effects"] == [
        "report: install id made sure of", "report: usage and error windows started again", "report: run log kept",
        f"object state cleared: {_TAG}", f"object labelled: {_PHONE} = 'Tile'",
        "report counter: plan_build_setting:on",
        "report counter: showcase_on", "report counter: showcase_forest_default",
        _SAVED, "snapshot cache dropped"]


# ── D: lists and maps of names keep names only ───────────────────────────────

_MIXED = ["  map_1  ", "  ", "", 5, None, ["x"], {"y": 1}, "map_2"]


@pytest.mark.parametrize("key", ["hidden_map_ids", "lights_hidden", "beacon_tune_disabled",
                                 "distance_stationary_devices"])
def test_a_list_of_names_keeps_the_names_only(key: str) -> None:
    assert send({key: _MIXED})["written"] == [{key: ["map_1", "map_2"]}]


def test_followed_objects_are_names_only_in_capitals() -> None:
    got = send({"followed_addrs": [" c0:ff:ee:00:00:01 ", "  ", "", 5, None, ["x"], "device_tracker.phone"]})
    assert got["written"] == [{"followed_addrs": [_PHONE, "DEVICE_TRACKER.PHONE"]}]


@pytest.mark.parametrize("key", ["espresense_room_map", "beacon_group_overrides"])
def test_a_map_of_names_keeps_the_names_only(key: str) -> None:
    got = send({key: {"kitchen": "Kitchen", "none": None, "list": [1], "number": 5, "dict": {"c": 1},
                      "blank": "  ", "": "no name", " hall ": " Hall "}})
    assert got["written"] == [{key: {"kitchen": "Kitchen", "hall": "Hall"}}]


def test_what_the_panel_sends_for_these_keys_is_kept_as_sent() -> None:
    """views/manage.js (beacon tuning, group overrides), views/traceback.js
    (stationary references), views/maps.js and lights_panel.js (hidden maps
    and lights): ids and keys as text."""
    sends = {"beacon_tune_disabled": ["C0FFEE000004", "ibeacon:0a1b2c3d:1:2"],
             "beacon_group_overrides": {"C0FFEE000004": "solo:C0FFEE000004"},
             "distance_stationary_devices": [_PHONE, "IRK:0a1b2c3d4e"],
             "hidden_map_ids": ["map_1", "map_2"],
             "lights_hidden": ["light.kitchen", "switch.pump"],
             "advanced_extra_tabs": ["devices", "bluetooth", "presence", "monitor", "qa", "sandbox"]}
    assert send(sends)["written"] == [sends]


@pytest.mark.parametrize(("typed", "stored"), [
    ("http://espresense:8267", "http://espresense:8267"),
    (" http://espresense.local:8267/ ", "http://espresense.local:8267"),
    ("https://companion.example/base", "https://companion.example/base"),
    ("http://192.168.1.50:8267", "http://192.168.1.50:8267"),
    ("", ""), ("   ", ""),
])
def test_the_companions_address_is_an_http_or_https_url_or_empty(typed: str, stored: str) -> None:
    got = send({"espresense_companion_url": typed}, start={"espresense_companion_url": "http://old:1"})
    assert got["error"] is None and got["written"] == [{"espresense_companion_url": stored}]


@pytest.mark.parametrize("typed", ["espresense:8267", "no such word", "ftp://espresense/", "file:///etc/passwd",
                                   "javascript:alert(1)", "http://", "http:///path", "http://two words",
                                   "//espresense:8267", "http://[bad"])
def test_any_other_address_is_refused_and_the_old_one_stays(typed: str) -> None:
    got = send({"espresense_companion_url": typed}, start={"espresense_companion_url": "http://old:1"})
    assert changed_nothing(got) and got["error"][0] == "invalid_format"
    assert got["data"]["espresense_companion_url"] == "http://old:1"


# ── a number that cannot be stored, anywhere inside a value ───────────────────

def test_an_unstorable_number_is_found_at_any_depth():
    from custom_components.padspan_ha.ws_settings import _unstorable_number as bad

    nan, inf = float("nan"), float("inf")
    for value in (nan, inf, -inf, 2 ** 64, -(2 ** 63) - 1, [1, [nan]], {"a": {"b": inf}}, {"a": [{"b": 10 ** 30}]},
                  [{"match": {"name": nan}}], {"snoozes": inf}):
        assert bad(value), value
    deep: list = []
    for _ in range(3000):       # far deeper than Python's own limit: answered, never raised
        deep = [deep]
    assert bad(deep)
    for value in (0, 1.5, -3, True, False, None, "nan", "inf", 2 ** 63, -(2 ** 63), 2 ** 64 - 1, [1, "nan", {"a": 2.5}],
                  {"a": {"b": [1, 2, 3]}}, "", [], {}):
        assert not bad(value), value


def test_the_command_checks_every_value_for_one_before_it_reads_any_key():
    """Held on the source: the check sits before the first key is read, so a
    message it refuses has done nothing."""
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    body = src[src.index("async def ws_settings_set("):]
    assert "_unstorable_number(_vv)" in body
    assert body.index("_unstorable_number(_vv)") < body.index("payload: dict[str, Any] = {}")


# ── E: a setting with a few fixed choices takes those only ────────────────────
# An unknown word used to be stored as a fallback without a word: a live
# house switched to the sample house, the learned model back to calibration
# matching, a tier override cleared. Now refused in words; the panel's
# style keeps its documented fallback (classic), so a bad value never leaves
# anyone on a style that failed to load.

_CHOICES = {
    "data_mode": (("live", "sample"), "sample", "live"),
    "positioning_algorithm": (("knn", "rf"), "rf", "knn"),
    "auto_offset_mode": (("off", "partial", "full"), "off", "full"),
    "license_tier_override": (("", "free", "bright", "pro"), "bright", "free"),
}


@pytest.mark.parametrize("key", sorted(_CHOICES))
def test_each_choice_is_taken_whatever_its_capitals(key: str) -> None:
    choices, start, _other = _CHOICES[key]
    for choice in choices:
        got = send({key: f" {choice.upper()} "}, start={key: start})
        assert got["error"] is None and got["data"][key] == choice, (key, choice, got["error"])


@pytest.mark.parametrize("key", sorted(_CHOICES))
@pytest.mark.parametrize("typed", ["no such word", "zz_missing", "x" * 300, "live mode", "Pro!"])
def test_an_unknown_choice_is_refused_in_words_and_the_old_one_stays(key: str, typed: str) -> None:
    _choices, start, _other = _CHOICES[key]
    got = send({key: typed}, start={key: start})
    assert changed_nothing(got) and got["error"][0] == "invalid_format", got["error"]
    assert '"' in got["error"][1] and "Python" not in got["error"][1]
    assert got["data"][key] == start


@pytest.mark.parametrize("key", ["data_mode", "positioning_algorithm", "auto_offset_mode"])
def test_no_choice_at_all_is_refused_too(key: str) -> None:
    _choices, start, _other = _CHOICES[key]
    got = send({key: "  "}, start={key: start})
    assert changed_nothing(got) and got["data"][key] == start


def test_an_empty_tier_override_clears_it() -> None:
    got = send({"license_tier_override": ""}, start={"license_tier_override": "free"})
    assert got["error"] is None and got["data"]["license_tier_override"] == ""


def test_an_unknown_style_falls_back_to_classic_as_documented() -> None:
    for typed, stored in (("2025", "2025"), (" Classic ", "classic"), ("no such word", "classic"), ("", "classic")):
        got = send({"ui_skin": typed}, start={"ui_skin": "2025"})
        assert got["error"] is None and got["data"]["ui_skin"] == stored, typed


def test_the_panel_sends_only_known_choices() -> None:
    """settings.js (style, positioning, tier override), panel.js and manage.js
    (back to Live): every value they send is one of the choices."""
    from pathlib import Path
    import re

    www = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
    js = "\n".join(p.read_text(encoding="utf-8") for p in www.rglob("*.js") if "vendor" not in p.parts)
    assert set(re.findall(r'data_mode: "(\w*)"', js)) == {"live"}
    assert set(re.findall(r'ui_skin: (?:"(\w*)"|val\b)', js)) <= {"", "2025", "classic"}
    assert 'value: "knn"' in js and 'value: "rf"' in js
    assert '[["",t("(no override)")],["free",t("free")],["bright","bright"],["pro","pro"]]' in js
    assert not re.search(r"auto_offset_mode\s*:\s*[\"'\w]", js.replace("read auto_offset_mode: positioning", ""))
