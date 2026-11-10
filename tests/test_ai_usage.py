# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The AI credit tracker (ai_usage.py, experimental, 2026-11; design:
PadspanResearch plan-build-design-2026-11.md sections 9, 10 and 14).

Held here:
- one record per ask(), answered or failed, with the one named reason it
  stopped; an unusable answer and a read refused before it was sent count
  as stops too (the stall watch);
- the estimate's formula, its picture cap, its price table and the one
  CALIBRATION constant; a model with no price gets no dollar figure, and a
  local AI only reads;
- per calendar month, 13 months kept; the month's bands told to the report
  once, when it has ended;
- the warning off by default, and once a month when on;
- the two settings: defaults, schema, an administrator's, clamped;
- the report: closed names, each with a call site and a plain name, nothing
  identifying, nothing while the report is off, _TOP_KEYS unchanged;
- the store: emptied by a Factory Reset, never in a backup.
"""

from __future__ import annotations

import io
import json
import re
import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from PIL import Image

from custom_components.padspan_ha import ai_usage as U
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_store import _house, _run

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WWW = _CC / "www" / "padspan-ha"
_CLAUDE = "ai_task.claude_ai_task"
_LOCAL = "ai_task.vision_qwen"


class _Store:
    """Home Assistant's Store, in memory: the delayed save is taken at once."""
    saved: dict = {}

    def __init__(self, hass, version, key):
        self.key = key

    async def async_load(self):
        return json.loads(json.dumps(_Store.saved[self.key])) if self.key in _Store.saved else None

    def async_delay_save(self, fn, delay):
        _Store.saved[self.key] = json.loads(json.dumps(fn()))

    async def async_save(self, data):
        _Store.saved[self.key] = json.loads(json.dumps(data))


def _jpeg(w: int, h: int) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(b, "JPEG", quality=60)
    return b.getvalue()


@pytest.fixture
def house(monkeypatch):
    """A house with Claude (Opus 5.5) and a local AI, the month 2026-11-09, and
    every report event caught."""
    import homeassistant.helpers.storage as hs
    _Store.saved = {}
    monkeypatch.setattr(hs, "Store", _Store)
    h = _house()
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = _CLAUDE
    clock = {"now": datetime(2026, 11, 9, 16, 5)}
    monkeypatch.setattr(U, "_now_local", lambda: clock["now"])
    monkeypatch.setattr(U, "_platform", lambda hass, eid: {_CLAUDE: "anthropic", _LOCAL: "ollama"}.get(eid))
    monkeypatch.setattr(U, "model_of", lambda hass, eid: {_CLAUDE: "claude-opus-5-5", _LOCAL: "qwen2.5vl:7b"}.get(eid))
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e) or True)
    notes: list[dict] = []
    pn = types.ModuleType("homeassistant.components.persistent_notification")
    pn.async_create = lambda hass, message, title=None, notification_id=None, **kw: notes.append(
        {"message": message, "title": title, "id": notification_id})
    monkeypatch.setitem(sys.modules, "homeassistant.components.persistent_notification", pn)
    return SimpleNamespace(h=h, clock=clock, counted=counted, notes=notes)


def _row(h, eid=_CLAUDE, month="2026-11"):
    return U.usage(h).data["months"][month][eid]


def _read(h, eid=_CLAUDE, *, size=(1024, 768), chars=2000, reason=None, sent=True, task="PadSpan plans"):
    U.note_read(h, eid, task, size=size, prompt_chars=chars, secs=4.7, sent=sent, reason=reason)


# ═══ the estimate ════════════════════════════════════════════════════════════

def test_the_formula_by_hand_and_the_one_calibration_constant():
    # Section 9: min(w×h÷750, 4784) + chars÷4 + 300 in, 400 out, at Opus 5.5's $4 / $20.
    usd = U.estimate_usd((4.0, 20.0), (1024, 768), 2000)
    assert usd == pytest.approx(((1024 * 768 / 750 + 500 + 300) * 4 + 400 * 20) / 1e6)
    assert 0.014 < usd < 0.016                        # "≈ $0.015 a read" (design, today's run)
    big = U.estimate_usd((4.0, 20.0), (2560, 1600), 0)
    assert big == pytest.approx(((4784 + 300) * 4 + 400 * 20) / 1e6), "a picture's tokens are capped"
    assert U.estimate_usd(None, (1024, 768), 2000) is None
    assert U.estimate_usd((4.0, 20.0), None, 0) == pytest.approx((300 * 4 + 400 * 20) / 1e6)
    # The calibration is 1.0 until a Console figure is read, and is clamped.
    assert U.CALIBRATION == 1.0 and U.CALIBRATION_RANGE == (0.2, 5.0)
    src = Path(U.__file__).read_text(encoding="utf-8")
    assert src.count("\nCALIBRATION = ") == 1 and "THE ONE PLACE" in src and "2026-11-09" in src


@pytest.mark.parametrize("model,price", [
    ("claude-opus-5-5", (4.0, 20.0)), ("Claude Opus 5.5", (4.0, 20.0)), ("claude-opus-5", (5.0, 25.0)),
    ("claude-fable-5-1", (10.0, 50.0)), ("Claude Fable 5", (10.0, 50.0)), ("claude-mythos-5-1", (10.0, 50.0)),
    ("claude-sonnet-5-5", (2.0, 10.0)), ("claude-haiku-5-5", (0.10, 0.50)), ("claude-haiku-4-5-20251001", (1.0, 5.0)),
    ("claude-opus-4-8", (5.0, 25.0)), ("claude-opus-5-20260301", (5.0, 25.0)),
    ("claude-sonnet-4-5-20250929", None), ("claude-opus-latest", None), ("gpt-5", None), ("", None), (None, None)])
def test_the_price_table(model, price):
    assert U.price_of(model) == price


def test_the_model_is_read_where_the_plan_ai_reads_it(monkeypatch):
    """One reader (plan_ai._model_text): the Anthropic integration names the model
    on its device and its sub-entry's chat_model; the last named counts."""
    import homeassistant.helpers.device_registry as dr
    import homeassistant.helpers.entity_registry as er
    ents = {_CLAUDE: SimpleNamespace(name=None, original_name="Claude AI Task", config_entry_id="e1",
                                     config_subentry_id="s1", device_id="d1"),
            _LOCAL: SimpleNamespace(name="Opus 5 vision", original_name=None, config_entry_id="e2",
                                    config_subentry_id="s2", device_id="d2")}
    devs = {"d1": SimpleNamespace(model_id="claude-opus-5-5", model="Claude Opus 5.5"),
            "d2": SimpleNamespace(model_id=None, model="qwen2.5vl:7b")}
    entries = {"e1": SimpleNamespace(subentries={"s1": SimpleNamespace(data={"chat_model": "claude-opus-5-5"})}, options={}, data={}),
               "e2": SimpleNamespace(subentries={"s2": SimpleNamespace(data={"model": "qwen2.5vl:7b"})}, options={}, data={})}
    monkeypatch.setattr(er, "async_get", lambda hass: SimpleNamespace(async_get=ents.get), raising=False)
    monkeypatch.setattr(dr, "async_get", lambda hass: SimpleNamespace(async_get=devs.get), raising=False)
    h = _house()
    h.config_entries.async_get_entry = entries.get
    assert U.model_of(h, _CLAUDE) == "opus 5.5" and U.price_of(U.model_of(h, _CLAUDE)) == (4.0, 20.0)
    assert U.model_of(h, _LOCAL) == "opus 5", "only a name says Opus here: the reader's words, priced only for a Claude AI Task"
    assert U.model_of(h, "ai_task.gone") is None


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_the_picture_size_comes_from_the_header(fmt):
    for size in ((1, 1), (1024, 768), (2560, 1600), (333, 2001)):
        b = io.BytesIO()
        Image.new("RGB", size, "white").save(b, fmt, **({"lossless": True} if fmt == "WEBP" else {}))
        assert U.picture_size(b.getvalue()) == size, (fmt, size)
        if fmt == "WEBP":
            b = io.BytesIO()
            Image.new("RGB", size, "white").save(b, fmt, quality=50)
            assert U.picture_size(b.getvalue()) == size
    assert U.picture_size(b"not a picture") is None and U.picture_size(b"\xff\xd8\xff") is None


# ═══ counting ════════════════════════════════════════════════════════════════

class _Ai:
    def __init__(self, answer):
        self.answer, self.calls = answer, 0

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        self.calls += 1
        if isinstance(self.answer, BaseException):
            raise self.answer
        return {"data": self.answer}


class HomeAssistantError(Exception):
    """homeassistant.exceptions.HomeAssistantError, as the Anthropic integration raises it."""


def test_one_record_per_ask_answered_or_failed_each_with_its_reason(house, tmp_path):
    h = house.h
    media = tmp_path / "media"
    media.mkdir()
    h.config.media_dirs = {"local": str(media)}
    pic = _jpeg(800, 600)
    cases = [("an answer", None), (TimeoutError(), "timeout"), (ConnectionRefusedError(111, "refused"), "unreachable"),
             (HomeAssistantError("Error talking to API: Your credit balance is too low to access the Anthropic API."), "no_credit"),
             (HomeAssistantError("Sorry, I can't help with that."), "refusal"), (RuntimeError("boom"), "error")]
    for answer, _reason in cases:
        h.services.async_call = _Ai(answer)
        try:
            _run(P.ask(h, _CLAUDE, "Read the plan.", None, pic, "image/jpeg", "PadSpan plans"))
        except Exception:  # noqa: BLE001
            pass
    row = _row(h)
    assert row["reads"] == len(cases) and row["by_kind"] == {"plans": len(cases)}
    assert row["stops"] == {"timeout": 1, "unreachable": 1, "no_credit": 1, "refusal": 1, "error": 1}
    one = U.estimate_usd((4.0, 20.0), (800, 600), len("Read the plan."))
    # Spend: the answer, the timeout and the refusal reached the AI; the rest didn't.
    assert row["est_usd"] == pytest.approx(3 * one) and row["priced"] is True
    assert row["megapixels"] == pytest.approx(len(cases) * 0.48)
    # No media folder: a stop, never a read.
    h.config.media_dirs = {}
    h.services.async_call = _Ai("never")
    with pytest.raises(P._NoMedia):  # noqa: SLF001
        _run(P.ask(h, _CLAUDE, "Read the plan.", None, pic, "image/jpeg", "PadSpan plans"))
    assert h.services.async_call.calls == 0
    assert _row(h)["reads"] == len(cases) and _row(h)["stops"]["no_media"] == 1
    assert [e for e in house.counted if e.startswith("ai_reads_fail:")] == [
        "ai_reads_fail:timeout", "ai_reads_fail:unreachable", "ai_reads_fail:no_credit", "ai_reads_fail:refusal",
        "ai_reads_fail:error", "ai_reads_fail:no_media"]
    assert house.counted.count("ai_reads_kind:plans") == len(cases) and house.counted.count("ai_reads_maker:claude") == len(cases)


def test_the_structure_counts_in_the_prompt_and_the_photo_is_a_photo(house, tmp_path):
    h = house.h
    h.config.media_dirs = {"local": str(tmp_path)}
    h.services.async_call = _Ai({"kind": "sofa"})
    structure = {"kind": {"description": "what it is", "selector": {"select": {"options": ["sofa", "bed"]}}}}
    _run(P.ask(h, _CLAUDE, "What is it?", structure, _jpeg(10, 10), "image/jpeg"))
    row = _row(h)
    assert row["by_kind"] == {"photo": 1} and row["prompt_chars"] == len("What is it?") + len(json.dumps(structure))


def test_unusable_answers_and_refused_reads_are_stops_with_a_reason(house):
    h = house.h
    _read(h)
    assert U.unusable(h, _CLAUDE, "I'm sorry, I can't help with reading this plan.") == "refusal"
    assert U.unusable(h, _CLAUDE, "[[12, 40, 300]] maybe") == "bad_answer"
    assert U.unusable(h, _CLAUDE, {"kind": None}) == "bad_answer"
    U.refused(h, "no_ai", "")
    U.refused(h, "no_fallback", _CLAUDE)
    U.refused(h, "not_a_reason", _CLAUDE)                     # never a new name: counted as error
    assert _row(h)["stops"] == {"refusal": 1, "bad_answer": 2, "no_fallback": 1, "error": 1} and _row(h)["reads"] == 1
    assert _row(h, "")["stops"] == {"no_ai": 1} and _row(h, "")["reads"] == 0
    assert set(U.STOP_WORDS) == set(U.STOP_REASONS)
    stops = U.summary(h, U.usage(h))["stops"]
    assert [s["reason"] for s in stops] == ["refusal", "bad_answer", "no_ai", "no_fallback", "error"]
    assert stops[0] == {"reason": "refusal", "n": 1, "words": "the AI declined"}


def test_the_callers_count_their_stops(monkeypatch):
    """Every place that turns a read down or can't use its answer says so."""
    src = {p: (_CC / p).read_text(encoding="utf-8") for p in ("ws_house3d_photo.py", "ws_house3d_stairs.py", "plan_ai.py", "ws_plan_ai.py")}
    assert 'U.refused(hass, "no_ai", ai.get("ai_task"))' in src["ws_house3d_photo.py"]
    assert "U.unusable(hass, by)" in src["ws_house3d_photo.py"]
    assert 'U.refused(hass, "no_ai", ai.get("ai_task"))' in src["ws_house3d_stairs.py"] and "U.unusable(hass, by, answer)" in src["ws_house3d_stairs.py"]
    assert 'U.refused(hass, "no_ai", ai.get("ai_task"))' in src["ws_plan_ai.py"]
    assert src["plan_ai.py"].count("U.unusable(") == 3
    # ask() is still the one generate_data call, and every call goes through the counter.
    calls = [p.name for p in _CC.glob("*.py") if '"ai_task", "generate_data"' in p.read_text(encoding="utf-8")]
    assert calls == ["ws_house3d_photo.py"]
    photo = src["ws_house3d_photo.py"]
    assert photo.count("await hass.services.async_call(\"ai_task\", \"generate_data\"") == 1
    assert "return await _ask_once(" in photo and photo.count("_ask_once(") == 2
    assert "U.note_read(" in photo[photo.index("async def ask("):photo.index("async def _ask_once(")]


def test_a_local_ai_only_reads_and_an_unknown_claude_model_has_no_dollars(house, monkeypatch):
    h = house.h
    _read(h, _LOCAL)
    row = _row(h, _LOCAL)
    assert row["reads"] == 1 and row["est_usd"] == 0 and row["priced"] is False and row["maker"] == "ollama"
    monkeypatch.setattr(U, "model_of", lambda hass, eid: "claude-opus-latest")
    _read(h, _CLAUDE)
    assert _row(h)["priced"] is False and _row(h)["est_usd"] == 0
    s = U.summary(h, U.usage(h))
    assert s["claude_reads"] == 1 and s["claude_usd"] is None and s["reads"] == 2 and s["main_priced"] is False


def test_per_month_local_time_with_13_months_kept(house):
    h = house.h
    for m in range(1, 16):
        house.clock["now"] = datetime(2025 + (m - 1) // 12, (m - 1) % 12 + 1, 3, 9, 0)
        _read(h)
    months = sorted(U.usage(h).data["months"])
    assert len(months) == 13 and months[0] == "2025-03" and months[-1] == "2026-03"
    assert _row(h, month="2026-03")["days"] == {"03": {"reads": 1, "est_usd": pytest.approx(U.estimate_usd((4, 20), (1024, 768), 2000), abs=1e-6)}}


def test_a_month_that_ended_is_told_to_the_report_once_in_bands(house):
    h = house.h
    house.clock["now"] = datetime(2026, 10, 30, 12, 0)
    for _ in range(25):
        _read(h)
    _read(h, _LOCAL)
    assert not [e for e in house.counted if e.startswith(("ai_reads_month:", "ai_credit_month:"))]
    house.clock["now"] = datetime(2026, 11, 1, 0, 5)
    U.summary(h, U.usage(h))
    U.summary(h, U.usage(h))
    _read(h)
    told = [e for e in house.counted if e.startswith(("ai_reads_month:", "ai_credit_month:"))]
    assert told == ["ai_reads_month:21_100", "ai_credit_month:lt1"]
    # A month with no reads at all, after one with some, is told as 0 (none: nothing priced).
    house.counted.clear()
    house.clock["now"] = datetime(2027, 1, 2, 8, 0)
    U.summary(h, U.usage(h))
    assert [e for e in house.counted if e.startswith(("ai_reads_month:", "ai_credit_month:"))] == [
        "ai_reads_month:1_20", "ai_credit_month:lt1", "ai_reads_month:0", "ai_credit_month:none"]


@pytest.mark.parametrize("n,band", [(0, "0"), (1, "1_20"), (20, "1_20"), (21, "21_100"), (500, "101_500"), (501, "gt500")])
def test_the_reads_bands(n, band):
    assert U.reads_band(n) == band


@pytest.mark.parametrize("usd,band", [(None, "none"), (0.0, "lt1"), (0.99, "lt1"), (1, "1_5"), (19.9, "5_20"), (49, "20_50"), (50, "gt50")])
def test_the_credit_bands(usd, band):
    assert U.credit_band(usd) == band


# ═══ the warning ═════════════════════════════════════════════════════════════

def test_the_warning_is_off_by_default_and_once_a_month_when_on(house):
    h = house.h
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st["ai_credit_month_usd"] = 0.02
    for _ in range(5):
        _read(h)                                                       # well past, but off
    assert house.notes == [] and DEFAULT_SETTINGS["ai_credit_warn_pct"] == 0
    st["ai_credit_warn_pct"] = 90
    _read(h)
    _read(h)
    assert len(house.notes) == 1 and house.counted.count("ai_credit_warn:fired") == 1
    note = house.notes[0]
    assert note["title"] == "PadSpan: AI credit" and note["id"] == "padspan_ha_ai_credit_2026-11"
    assert "estimate" in note["message"] and "https://platform.claude.com/usage" in note["message"]
    assert "Home Assistant uses" in note["message"] and "90 %" in note["message"]
    assert U.summary(h, U.usage(h))["warned"] is True
    house.clock["now"] = datetime(2026, 12, 1, 9, 0)
    _read(h)                                                           # under 90 % of the new month
    assert len(house.notes) == 1
    for _ in range(2):
        _read(h)
    assert len(house.notes) == 2 and house.notes[1]["id"] == "padspan_ha_ai_credit_2026-12"


def test_no_warning_without_a_credit_typed_in_nor_for_a_local_ai(house):
    h = house.h
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st["ai_credit_warn_pct"] = 50
    for _ in range(3):
        _read(h)
    assert house.notes == []
    st["ai_credit_month_usd"] = 0.0001
    house.clock["now"] = datetime(2026, 12, 1, 9, 0)                   # a month of local reads only
    for _ in range(3):
        _read(h, _LOCAL)
    assert house.notes == []


# ═══ the settings ════════════════════════════════════════════════════════════

def _set(h, admin=True, **kw):
    conn = MagicMock()
    conn.user = MagicMock(is_admin=admin)
    _run(WS.ws_settings_set(h, conn, {"id": 1, **kw}))
    return conn, h.data[DOMAIN][DATA_SETTINGS].data


def test_the_two_settings_are_plumbed_clamped_and_an_administrators(monkeypatch):
    assert DEFAULT_SETTINGS["ai_credit_month_usd"] == 0 and DEFAULT_SETTINGS["ai_credit_warn_pct"] == 0
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"ai_credit_month_usd", "ai_credit_warn_pct"} <= keys
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e) or True)
    h = _house()
    conn, data = _set(h, ai_credit_month_usd="200", ai_credit_warn_pct=75)
    assert not conn.send_error.called and data["ai_credit_month_usd"] == 200.0 and data["ai_credit_warn_pct"] == 75
    assert counted == ["ai_credit_warn:set_75"]
    _set(h, ai_credit_warn_pct=75)
    assert counted == ["ai_credit_warn:set_75"], "the same share again is no new choice"
    for typed, kept in (("", 0), (None, 0), (-5, 0), ("abc", 0), (1e9, U.CREDIT_MAX_USD), (12.345, 12.35)):
        assert _set(h, ai_credit_month_usd=typed)[1]["ai_credit_month_usd"] == kept, typed
    for typed, kept in ((60, 0), ("90", 90), (50.0, 50), (0, 0), ("x", 0)):
        assert _set(h, ai_credit_warn_pct=typed)[1]["ai_credit_warn_pct"] == kept, typed
    assert counted[-2:] == ["ai_credit_warn:set_50", "ai_credit_warn:off"]
    conn, data = _set(h, admin=False, ai_credit_month_usd=5, ai_credit_warn_pct=90)
    assert conn.send_error.call_args[0][1] == "unauthorized" and data["ai_credit_month_usd"] != 5 and data["ai_credit_warn_pct"] == 0


# ═══ the opt-in report ═══════════════════════════════════════════════════════

def test_the_family_is_closed_each_name_has_a_call_site_and_a_plain_name():
    src = Path(U.__file__).read_text(encoding="utf-8") + (_CC / "ws_settings.py").read_text(encoding="utf-8")
    for e in T.AI_USAGE_EVENTS:
        assert T.event_allowed(e) and len(e) <= 64, e
        fam, _, val = e.partition(":")
        assert f'f"{fam}:{{' in src or f'"{e}"' in src or (fam == "ai_credit_warn" and val.startswith("set_")), e
    assert {e.partition(":")[2] for e in T.AI_USAGE_EVENTS if e.startswith("ai_reads_fail:")} == set(U.STOP_REASONS)
    assert not T.event_allowed("ai_reads_fail:anything") and not T.event_allowed(f"ai_reads_kind:{_CLAUDE}")
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    for prefix in sorted({e.partition(":")[0] for e in T.AI_USAGE_EVENTS}):
        assert f'"{prefix}"' in ib, prefix
    for reason in U.STOP_REASONS:
        assert f"{reason}:" in ib[ib.index('"ai_reads_fail"'):], reason


def test_the_report_identifies_nothing(monkeypatch):
    """A month of reads seeded on purpose with what must never leave: the AI
    Task, its model, a $200 credit, exact dollars, prompts, picture sizes."""
    import homeassistant.helpers.storage as hs
    from tests.test_telemetry import _hass
    _Store.saved = {}
    monkeypatch.setattr(hs, "Store", _Store)
    h = _hass()
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st.update({"atlas_3d_ai_task_entity": _CLAUDE, "ai_credit_month_usd": 200.0, "ai_credit_warn_pct": 75})
    clock = {"now": datetime(2026, 11, 9, 16, 0)}
    monkeypatch.setattr(U, "_now_local", lambda: clock["now"])
    monkeypatch.setattr(U, "_platform", lambda hass, eid: "anthropic")
    monkeypatch.setattr(U, "model_of", lambda hass, eid: "claude-opus-5-5")
    for i in range(175):
        U.note_read(h, _CLAUDE, "PadSpan plans", size=(1123, 794), prompt_chars=1234 + i, secs=4.7, sent=True,
                    reason="timeout" if i % 50 == 0 else None)
    U.unusable(h, _CLAUDE, "I'm sorry, I can't read 12 Oak St, Squamish")
    U.refused(h, "no_ai", "ai_task.garrys_office")
    clock["now"] = datetime(2026, 12, 2, 8, 0)
    U.summary(h, U.usage(h))                                            # November ends: its bands go
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    assert set(payload) <= T._TOP_KEYS                                  # noqa: SLF001
    usage = payload["usage"]
    ours = {k: v for k, v in usage.items() if k.startswith(("ai_reads_", "ai_credit_"))}
    assert ours and set(ours) <= T.AI_USAGE_EVENTS and all(isinstance(v, int) and not isinstance(v, bool) for v in ours.values())
    assert ours["ai_reads_kind:plans"] == 175 and ours["ai_reads_fail:timeout"] == 4 and ours["ai_reads_fail:refusal"] == 1
    assert ours["ai_reads_month:101_500"] == 1 and ours["ai_credit_month:1_5"] == 1
    text = json.dumps(payload)
    for seeded in (_CLAUDE, "claude_ai_task", "garrys_office", "claude-opus-5-5", "Opus", "Oak St", "Squamish",
                   "1123", "794", "1234", "200.0", "$"):
        assert seeded not in text, seeded
    assert not re.search(r"\d\.\d", json.dumps(usage)), "no exact figure under usage"
    assert "ai_credit_month_usd" not in json.dumps(payload.get("features"))


def test_off_counts_nothing(monkeypatch):
    import homeassistant.helpers.storage as hs
    from tests.test_telemetry import _hass
    monkeypatch.setattr(hs, "Store", _Store)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    U.note_read(h, _CLAUDE, "PadSpan plans", size=(10, 10), prompt_chars=5, secs=1, sent=True, reason="timeout")
    U.refused(h, "no_ai")
    assert not h.data[DOMAIN].get(T._DATA_COUNTERS)                     # noqa: SLF001


def test_the_report_needs_no_server_change():
    assert T._TOP_KEYS == frozenset({                                   # noqa: SLF001
        "schema", "install_id", "day", "version", "edition", "tier", "ha_version",
        "python", "env", "features", "usage", "health", "errors", "presets",
        "country", "language", "licence_group"})
    assert "ai_credit_month_usd" not in T._FEATURE_ON_ONLY and "ai_credit_warn_pct" not in T._FEATURE_ON_ONLY  # noqa: SLF001


# ═══ the store ═══════════════════════════════════════════════════════════════

def test_a_factory_reset_empties_it_and_no_backup_carries_it():
    from custom_components.padspan_ha import ws_common as C
    src = (_CC / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert "STORE_KEY as _AI_USAGE_KEY" in src and "_St(hass, 1, _AI_USAGE_KEY).async_save(_ai_usage_empty())" in src
    assert U.STORE_KEY not in C._DATA_KEY_MAP and U.STORE_KEY not in C._BACKUP_ONLY_ONCE_WRITTEN    # noqa: SLF001


def test_a_store_that_cannot_be_read_starts_empty(monkeypatch):
    import homeassistant.helpers.storage as hs

    class _Broken(_Store):
        async def async_load(self):
            raise OSError("bad disk")
    monkeypatch.setattr(hs, "Store", _Broken)
    h = _house()
    u = _run(U.async_ready(h))
    assert u.data == U.empty() and u.loaded


# ═══ Settings → AI ═══════════════════════════════════════════════════════════

def test_the_settings_line_and_its_controls():
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    body = src[src.index("function _aiUsageRow("):]
    body = body[:body.index("\nfunction ", 10)]
    assert 'ctx.actions.wsCall("padspan_ha/ai_usage_get")' in body
    assert "Claude reads this month: " in body and "AI reads this month: " in body and "of your $" in body
    assert "EXPERIMENTAL" in body and "estimate" in body
    assert "https://platform.claude.com/usage" in body and "filter by the key Home Assistant uses" in body
    assert 'save("ai_credit_month_usd"' in body and 'save("ai_credit_warn_pct"' in body
    assert '`${n} read${n === 1 ? "" : "s"} stopped: `' in body                                # "3 reads stopped: out of credit"
    assert '[["0", "Off"], ["50", "at 50 %"], ["75", "at 75 %"], ["90", "at 90 %"]]' in body       # off first, the default
    assert 'inp.value = credit > 0 ? String(credit) : "";' in body                                 # empty until typed
    assert 'controls.style.display = claude ? "flex" : "none";' in body                            # Claude only
    # Only an administrator asks for it (the command is admin-only).
    assert "ctx.hass.user.is_admin) card.appendChild(_aiUsageRow(ctx, el, save))" in src
    cmd = (_CC / "ai_usage.py").read_text(encoding="utf-8")
    assert "@websocket_api.require_admin" in cmd[cmd.index('"padspan_ha/ai_usage_get"'):]
