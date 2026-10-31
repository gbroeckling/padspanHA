# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Quicker photo reads (Garry, 2026-10-31, "Full"): a furniture photo with no
kind picked gets a quick look first (what it is, nothing else), then that
kind's own read; when the quick look isn't enough, the full first read runs as
before. Never a weaker answer, only sometimes a slower one.

Held here (ws_house3d_photo._read_furniture), with a fake AI Task:
- quick look names a kind: two reads (the quick one, that kind's own);
- quick look empty, "other", a box, words naming no kind, garbled, or an
  error Home Assistant raised over the answer: the full first read, then its
  kind's own read as before;
- the kind's own read unusable: the full first read, not the same kind again;
- a timeout or an unreachable AI Task: no extra read (the full one would fail
  the same way), the plain "couldn't read it" as before;
- a kind picked, a tag, a scanner, a person: one read as before;
- the backup still reads every read and is counted once; the report counts
  photo_quick:ok / :fallback; the screen sends 1024 px.
"""

from __future__ import annotations

import asyncio
import errno
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import house3d_builders as B
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (disk is a fixture)
from tests.test_house3d_photo import _AI, _SOFA, _leftovers, _photo, _ready

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_BK = "ai_task.server_vision"
_FULL = {**_SOFA, "what_it_is": "grey sofa"}


class _Seq:
    """ai_task.generate_data faked: answers (or raises) the next item of
    `answers` per call, each optionally after a pause; records which read
    each call was (quick, full, or a kind's own) and on which entity."""

    def __init__(self, answers, delays=None):
        self.answers, self.delays, self.calls = list(answers), list(delays or []), []

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        i = len(self.calls)
        if data["instructions"] == P.QUICK_PROMPT:
            what = "quick"
            assert data["structure"] == P.QUICK_STRUCTURE
        elif "what_it_is" in data["structure"]:
            what = "full"
            assert (data["instructions"], data["structure"]) == P.request("furniture", None)
        else:
            what = re.search(r"It is an? ([a-z ]+)\.", data["instructions"]).group(1)
        self.calls.append((what, data["entity_id"]))
        if i < len(self.delays) and self.delays[i]:
            await asyncio.sleep(self.delays[i])
        a = self.answers[i]
        if isinstance(a, BaseException):
            raise a
        return {"conversation_id": "c1", "data": a}

    @property
    def reads(self):
        return [w for w, _ in self.calls]


def _setup(monkeypatch, tmp_path, answers, delays=None):
    h, conn, _unused, media = _ready(monkeypatch, tmp_path)
    ai = _Seq(answers, delays)
    h.services.async_call = ai
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e))
    return h, conn, ai, media, counted


def _quick(counted):
    return [e for e in counted if e.startswith("photo_quick:")]


# ═══ the quick look is enough ════════════════════════════════════════════════

def test_a_quick_look_that_names_a_kind_is_one_quick_and_one_kind_read(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "grey corner sofa"}, dict(_SOFA)])
    out = _photo(h, conn)
    assert ai.reads == ["quick", "sofa"]
    assert out["ok"] and out["kind"] == "sofa" and out["recipe"]["params"]["seats"] == 3 and out["ai_task"] == _AI
    assert _quick(counted) == ["photo_quick:ok"] and "photo_read:ok" in counted
    assert _leftovers(media) == []


def test_the_quick_look_asks_only_what_it_is():
    assert set(P.QUICK_STRUCTURE) == {"what_it_is"} and P.QUICK_STRUCTURE["what_it_is"]["required"] is True
    assert P.quick_kind({"what_it_is": "office chair"}) == "chair"
    assert P.quick_kind('{"what_it_is": "double bed"}') == "bed", "an answer sent as text is read"


# ═══ not enough: the full read, as before ════════════════════════════════════

@pytest.mark.parametrize("quick", [None, {}, {"what_it_is": ""}, {"what_it_is": "   "}, {"what_it_is": "other"},
                                   {"what_it_is": "a box"}, {"what_it_is": "some kind of thing"},
                                   "I see a lovely room!", "{not json", {"what_it_is": 42}, ["sofa"],
                                   ValueError("Error with Ollama structured response")],
                         ids=["none", "empty", "blank", "spaces", "other", "box", "no kind", "prose", "garbled",
                              "number", "list", "ha refused the answer"])
def test_a_quick_look_that_isnt_enough_falls_back_to_the_full_read(monkeypatch, tmp_path, disk, quick):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [quick, dict(_FULL), dict(_SOFA)])
    out = _photo(h, conn)
    assert ai.reads == ["quick", "full", "sofa"], "the full read, then its kind's own read, as before"
    assert out["ok"] and out["kind"] == "sofa" and out["recipe"]["params"]["seats"] == 3
    assert _quick(counted) == ["photo_quick:fallback"] and _leftovers(media) == []


def test_a_kind_read_that_comes_back_unusable_falls_back_and_isnt_asked_again(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path,
                                         [{"what_it_is": "sofa"}, "no idea", dict(_FULL)])
    out = _photo(h, conn)
    assert ai.reads == ["quick", "sofa", "full"], "not the sofa's own read a second time"
    assert out["ok"] and out["kind"] == "sofa" and out["recipe"]["colors"][0] == "#5b6b7a"
    assert _quick(counted) == ["photo_quick:fallback"]


def test_after_a_wrong_quick_kind_the_full_reads_kind_is_asked(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path,
                                         [{"what_it_is": "office chair"}, "garbage", dict(_FULL), dict(_SOFA)])
    assert _photo(h, conn)["kind"] == "sofa" and ai.reads == ["quick", "chair", "full", "sofa"]


def test_the_fallbacks_full_read_stands_when_its_kind_read_fails(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{}, dict(_FULL), RuntimeError("oops")])
    out = _photo(h, conn)
    assert out["ok"] and out["kind"] == "sofa" and ai.reads == ["quick", "full", "sofa"]


def test_a_full_read_that_is_unusable_too_is_the_plain_bad_answer(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "thing"}, "still nothing"])
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "bad_answer" and ai.reads == ["quick", "full"]
    assert "photo_read:bad_answer" in counted and _quick(counted) == ["photo_quick:fallback"]


# ═══ no extra read where it can't help; the budget per read ═══════════════════

@pytest.mark.parametrize("fail", [TimeoutError(), ConnectionRefusedError(errno.ECONNREFUSED, "refused")],
                         ids=["timeout", "unreachable"])
def test_a_quick_look_that_times_out_or_cant_reach_the_ai_is_not_followed_by_a_full_read(monkeypatch, tmp_path,
                                                                                       disk, fail):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [fail])
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and ai.reads == ["quick"]
    assert _quick(counted) == [] and "photo_read:error" in counted and _leftovers(media) == []


def test_each_read_keeps_photo_timeout_s(monkeypatch, tmp_path, disk):
    """A slow quick look times out at PHOTO_TIMEOUT_S, plainly, and no full read
    makes the wait longer; a slow kind read the same."""
    monkeypatch.setattr(P, "PHOTO_TIMEOUT_S", 0.05)
    monkeypatch.setattr(P, "PHOTO_BUDGET_S", 10.0)
    monkeypatch.setattr(P, "READ_MIN_S", 0.0)
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [dict(_FULL)], delays=[5])
    out = _photo(h, conn)
    assert out["ok"] is False and "no answer" in out["message"] and ai.reads == ["quick"]
    h.services.async_call = ai = _Seq([{"what_it_is": "sofa"}, dict(_SOFA)], delays=[0, 5])
    out = _photo(h, conn)
    assert out["ok"] is False and "no answer" in out["message"] and ai.reads == ["quick", "sofa"]
    h.services.async_call = ai = _Seq([{"what_it_is": "sofa"}, dict(_SOFA)], delays=[0.01, 0.01])
    assert _photo(h, conn)["ok"], "reads under the limit each are fine"
    assert _leftovers(media) == []


def test_the_timeout_is_still_photo_timeout_s_and_unchanged():
    assert P.PHOTO_TIMEOUT_S == 240
    # The whole photo: the old two-read flow's worst case (8 minutes), not 4 x 240 s.
    assert P.PHOTO_BUDGET_S == 2 * P.PHOTO_TIMEOUT_S == 480
    assert P.READ_MIN_S == P.BACKUP_MIN_S + P.PROBE_S
    assert P._full_read_helps(ValueError("x")) and P._full_read_helps(RuntimeError("x"))
    assert not P._full_read_helps(TimeoutError()) and not P._full_read_helps(P._NoMedia())
    assert not P._full_read_helps(ConnectionRefusedError(errno.ECONNREFUSED, "refused"))


# ═══ one time budget for the whole photo ═════════════════════════════════════

def _budget(monkeypatch, timeout=0.2, budget=0.3, read_min=0.05):
    monkeypatch.setattr(P, "PHOTO_TIMEOUT_S", timeout)
    monkeypatch.setattr(P, "PHOTO_BUDGET_S", budget)
    monkeypatch.setattr(P, "READ_MIN_S", read_min)


def test_a_later_read_gets_only_the_time_left(monkeypatch, tmp_path, disk):
    """The kind's read would fit in PHOTO_TIMEOUT_S on its own, but not in
    what the quick look left of the budget."""
    _budget(monkeypatch)
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "sofa"}, dict(_SOFA)],
                                         delays=[0.15, 0.18])
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and ai.reads == ["quick", "sofa"]
    assert _leftovers(media) == []


def test_too_little_left_skips_the_full_read_and_keeps_the_best_answer(monkeypatch, tmp_path, disk):
    _budget(monkeypatch, timeout=1.0, budget=1.2, read_min=0.4)
    # The kind's read came back unusable with too little left: that answer stands, no full read.
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "sofa"}, "no idea"],
                                         delays=[0, 0.85])
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "bad_answer" and ai.reads == ["quick", "sofa"]
    assert _quick(counted) == [] and "photo_read:bad_answer" in counted
    # A quick look that named nothing, with too little left: no full read, the plain failure.
    h.services.async_call = ai = _Seq([{"what_it_is": "thing"}, dict(_FULL)], delays=[0.85])
    out = _photo(h, conn)
    assert out["ok"] is False and out["reason"] == "error" and ai.reads == ["quick"]
    # The full read answered with too little left for its kind's read: the full read stands.
    counted.clear()
    h.services.async_call = ai = _Seq([{"what_it_is": "thing"}, dict(_FULL), dict(_SOFA)], delays=[0, 0.85])
    out = _photo(h, conn)
    assert out["ok"] and out["kind"] == "sofa" and ai.reads == ["quick", "full"]
    assert _quick(counted) == ["photo_quick:fallback"] and _leftovers(media) == []


def test_the_fallback_is_not_counted_when_the_full_read_fails(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "thing"}, RuntimeError("down")])
    out = _photo(h, conn)
    assert out["ok"] is False and ai.reads == ["quick", "full"]
    assert _quick(counted) == [] and "photo_read:error" in counted


def test_the_backup_switch_works_inside_a_reads_time_left(monkeypatch):
    """ask_ai's backup rule uses the read's own time, not a fresh PHOTO_TIMEOUT_S:
    less than BACKUP_MIN_S of it left, no backup; else the backup gets what is left."""
    seen = []

    async def ask(hass, eid, instructions, structure, raw, mime, task_name="", timeout_s=None):
        seen.append((eid, timeout_s))
        if eid == _AI:
            raise ConnectionRefusedError(errno.ECONNREFUSED, "refused")
        return {"what_it_is": "sofa"}

    async def probe(hass, eid):
        return None
    monkeypatch.setattr(P, "ask", ask)
    monkeypatch.setattr(P, "_probe", probe)
    monkeypatch.setattr(P, "_bump", lambda hass, e: None)
    h = SimpleNamespace(data={DOMAIN: {}})
    ai = {"ai_task": _AI, "backup": _BK}
    with pytest.raises(ConnectionRefusedError):
        asyncio.run(P.ask_ai(h, ai, "q", None, b"x", "image/jpeg", timeout_s=P.BACKUP_MIN_S - 1))
    assert seen == [(_AI, P.BACKUP_MIN_S - 1)]
    seen.clear()
    h.data[DOMAIN].clear()
    answer, by = asyncio.run(P.ask_ai(h, ai, "q", None, b"x", "image/jpeg", timeout_s=P.BACKUP_MIN_S + 20))
    assert by == _BK and seen[0] == (_AI, P.BACKUP_MIN_S + 20)
    assert seen[1][0] == _BK and P.BACKUP_MIN_S <= seen[1][1] <= P.BACKUP_MIN_S + 20
    # With no backup the read's time is passed straight through.
    seen.clear()
    with pytest.raises(ConnectionRefusedError):
        asyncio.run(P.ask_ai(h, {"ai_task": _AI}, "q", None, b"x", "image/jpeg", timeout_s=99))
    assert seen == [(_AI, 99)]


def test_no_media_folder_is_still_the_plain_no_media_answer(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [dict(_FULL)])
    h.config.media_dirs = {"local": str(tmp_path / "not_there")}
    out = _photo(h, conn)
    assert out["message"] == P.NO_MEDIA and ai.calls == [] and _quick(counted) == []


# ═══ one read, as before ═════════════════════════════════════════════════════

def test_a_kind_picked_is_one_full_read_for_that_kind(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [dict(_SOFA)])
    assert _photo(h, conn, kind="sofa")["ok"] and ai.reads == ["sofa"] and _quick(counted) == []


@pytest.mark.parametrize("target", ["tag", "scanner", "person"])
def test_tags_scanners_and_people_are_one_read_as_before(monkeypatch, tmp_path, disk, target):
    h, conn, _unused, media = _ready(monkeypatch, tmp_path, answer={"color_1": "#ffffff", "width_m": 0.04})
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e))
    _photo(h, conn, target=target)
    calls = h.services.async_call.calls
    assert len(calls) == 1 and calls[0][2]["instructions"] != P.QUICK_PROMPT
    assert (calls[0][2]["instructions"], calls[0][2]["structure"]) == P.request(target, None)
    assert _quick(counted) == []


# ═══ the backup AI Task, every read ═══════════════════════════════════════════

def test_the_backup_reads_every_read_and_is_counted_once(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [{"what_it_is": "thing"}, dict(_FULL), dict(_SOFA)])
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = _BK
    states = {_AI: SimpleNamespace(state="unavailable", attributes={"friendly_name": "Mac", "supported_features": 3}),
              _BK: SimpleNamespace(state="idle", attributes={"friendly_name": "Server", "supported_features": 3})}
    h.states.get = states.get
    out = _photo(h, conn)
    assert ai.calls == [("quick", _BK), ("full", _BK), ("sofa", _BK)]
    assert out["ok"] and out["ai_task"] == _BK and out["by_backup"] is True
    assert counted.count("ai_backup_used") == 1 and _quick(counted) == ["photo_quick:fallback"]


def test_the_backup_takes_over_when_the_main_drops_during_the_quick_look(monkeypatch, tmp_path, disk):
    h, conn, ai, media, counted = _setup(monkeypatch, tmp_path, [ConnectionRefusedError(errno.ECONNREFUSED, "x"),
                                                                 {"what_it_is": "sofa"}, dict(_SOFA)])
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = _BK
    states = {e: SimpleNamespace(state="idle", attributes={"friendly_name": e, "supported_features": 3})
              for e in (_AI, _BK)}
    h.states.get = states.get

    async def _probe(hass, eid):
        return None
    monkeypatch.setattr(P, "_probe", _probe)
    out = _photo(h, conn)
    assert ai.calls == [("quick", _AI), ("quick", _BK), ("sofa", _BK)], "the main one is skipped after"
    assert out["ok"] and out["by_backup"] is True and counted.count("ai_backup_used") == 1
    assert _quick(counted) == ["photo_quick:ok"]


# ═══ the report and the screen ═══════════════════════════════════════════════

def test_the_report_counts_the_quick_look_by_name_only():
    for e in ("photo_quick:ok", "photo_quick:fallback"):
        assert e in T.PHOTO_EVENTS and T.event_allowed(e)
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert 'if (a === "photo_quick") return { ok: "AI photo read quickly' in ib
    assert "fallback: \"AI photo needed the full read" in ib


def test_the_screen_sends_1024_px_for_every_target():
    ph = (_WWW / "views" / "live_aboard_photo.js").read_text(encoding="utf-8")
    assert "export const PHOTO_MAX_PX = 1024;" in ph
    assert "export async function shrinkPhoto(file, max = PHOTO_MAX_PX)" in ph
    pe = (_WWW / "views" / "live_aboard_people.js").read_text(encoding="utf-8")
    assert pe.count("await shrinkPhoto(file)") == 1, "people, tags and receivers use the same default"
    assert "await shrinkPhoto(file)" in ph


def test_sample_mode_still_refuses_a_photo_read():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'if (type === "padspan_ha/house3d_from_photo") return payload.photo ? "write" : "read";' in panel


def test_the_quick_kind_is_never_the_box():
    assert P.quick_kind({"what_it_is": "box"}) is None
    assert B.BOX_KIND not in {P.quick_kind({"what_it_is": w}) for w in ("other", "box", "cube", "unknown")}
