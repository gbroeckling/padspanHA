# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""CaptureStore mechanics — the caps, the disk, and the promise not to touch anything.

A recorder that alters what it records is worse than no recorder, because the
trace it produces looks authoritative. Most of what is asserted here is that
nothing happens: no files when disabled, no mutated inputs, no session that
outgrows its ceiling.
"""

from __future__ import annotations

import json
import time
from typing import Any

from custom_components.padspan_ha import capture_store as cap_mod
from custom_components.padspan_ha.capture_store import (
    MAX_OBJECTS_PER_FRAME,
    MAX_SOURCES_PER_OBJECT,
    CaptureStore,
)

from tests.conftest import MockHass, MockStore

# Retention is measured against the wall clock: a session stamped further back
# than the retention window is evicted the instant it is written. Every
# timestamp below is an offset from T0, so the fixture ages the way a real
# session does instead of being permanently expired at some frozen literal.
T0 = time.time()


class FakeCoord:
    """Only the attributes record_frame borrows, all plain dicts."""

    def __init__(self) -> None:
        self._ema_rssi: dict[str, dict[str, float]] = {}
        self._kalman_p: dict[str, dict[str, float]] = {}
        self._silence_miss: dict[str, dict[str, int]] = {}
        self._room_votes: dict[str, Any] = {}
        self._confirmed_room: dict[str, str] = {}
        self._smooth_xy: dict[str, tuple[float, float]] = {}
        self._spatial_smooth_xy: dict[str, tuple[float, float]] = {}
        self._espresense_dist: dict[str, dict[str, float]] = {}


def _make_store(tmp_path) -> CaptureStore:
    cap = CaptureStore(MockHass(tmp_path))
    cap.store = MockStore()
    return cap


def _hdr(**kw: Any) -> dict[str, Any]:
    base = {"t": "hdr", "sv": 1, "ver": "test", "dm": "live",
            "poll_s": 5.0, "vw": 4, "vt": 3}
    base.update(kw)
    return base


def _obj(key: str, room: str = "Office", addr: str = "AA:BB:CC:00:00:01") -> dict[str, Any]:
    # identified=True on purpose: capture records identified or followed
    # objects only, so an anonymous fixture would record nothing and every
    # assertion below would pass vacuously.
    return {"key": key, "kind": "ble", "address": addr, "room": room, "identified": True,
            "room_confidence": 0.8, "x_m": 1.5, "y_m": 2.5, "floor_id": "main"}


async def _start(cap: CaptureStore, srcs: list[str], **kw: Any) -> str:
    sid = cap.start_session(_hdr(), sources=srcs,
                            source_to_area={s: "Office" for s in srcs},
                            source_to_floor={s: "main" for s in srcs},
                            now=T0, **kw)
    await cap.async_flush(now=T0)
    return sid


def _lines(cap: CaptureStore, sid: str) -> list[dict[str, Any]]:
    return [json.loads(x) for x in cap._path(sid).read_text(encoding="utf-8").splitlines() if x]


# ── the off switch ────────────────────────────────────────────────────────────

async def test_a_store_with_no_session_writes_nothing(tmp_path) -> None:
    """The default state of every install. Not a no-op by accident — by shape."""
    cap = _make_store(tmp_path)
    await cap.async_load()
    assert cap.recording is False
    assert cap.record_frame({"k": _obj("k")}, {}, {}, {}, {},
                            poll_s=5.0, vote_window=4, vote_threshold=3,
                            pinned={}, coord=FakeCoord()) is False
    await cap.async_maybe_flush(now=T0 + 1000)
    assert not list(tmp_path.glob("**/*.jsonl"))


async def test_recording_does_not_mutate_its_inputs(tmp_path) -> None:
    """The enforceable form of 'never destructive'.

    record_frame is handed the coordinator's live positioning state by
    reference. If it ever sorted, popped or rounded in place, the pipeline
    would start behaving differently while being recorded — and the recording
    would be the only evidence, which is a hard bug to ever find.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    await _start(cap, ["S1", "S2"])

    result = {"k1": _obj("k1")}
    rssi = {"AA:BB:CC:00:00:01": {"S1": -60.0, "S2": -71.0}}
    pinned = {"k1": {"room": "Office"}}
    coord = FakeCoord()
    coord._ema_rssi["AA:BB:CC:00:00:01"] = {"S1": -60.5}

    before = json.dumps([result, rssi, pinned, coord._ema_rssi], sort_keys=True)
    cap.record_frame(result, rssi, {}, {"S1": "Office"}, {"S1": "main"},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned=pinned, coord=coord, now=T0 + 5)
    assert json.dumps([result, rssi, pinned, coord._ema_rssi], sort_keys=True) == before


# ── the file ──────────────────────────────────────────────────────────────────

async def test_the_header_is_line_one_and_frames_follow(tmp_path) -> None:
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"])
    named = {**_obj("k1"), "user_label": "Office Phone"}
    cap.record_frame({"k1": named}, {"AA:BB:CC:00:00:01": {"S1": -60.0}}, {},
                     {"S1": "Office"}, {"S1": "main"},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned={}, coord=FakeCoord(), now=T0 + 5)
    await cap.async_flush(now=T0 + 5)

    lines = _lines(cap, sid)
    assert lines[0]["t"] == "hdr"
    assert lines[0]["sid"] == sid
    assert [x["t"] for x in lines[1:]] == ["env", "f"] or [x["t"] for x in lines[1:]] == ["f"]
    frame = [x for x in lines if x["t"] == "f"][0]
    assert frame["o"][0]["k"] == "k1"
    assert frame["o"][0]["r"] == "Office"
    # The device label belongs to the session, not to every frame of it.
    assert "_n" not in frame["o"][0], (
        "the label leaked into the frame; at 40 objects over an hour that is "
        "megabytes of the same string")
    assert cap._session["names"].get("k1") == "Office Phone"


async def test_a_flush_appends_and_never_rewrites(tmp_path) -> None:
    """Append-only is the whole reason traceback stopped killing SD cards."""
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"])
    size_hdr = cap._path(sid).stat().st_size

    for i, ts in enumerate((T0 + 5, T0 + 10)):
        cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": {"S1": -60.0 - i}}, {},
                         {"S1": "Office"}, {"S1": "main"},
                         poll_s=5.0, vote_window=4, vote_threshold=3,
                         pinned={}, coord=FakeCoord(), now=ts)
        await cap.async_flush(now=ts)

    text = cap._path(sid).read_text(encoding="utf-8")
    assert cap._path(sid).stat().st_size > size_hdr
    assert text.count('"t":"hdr"') == 1, "the header was rewritten"


async def test_a_torn_last_line_costs_exactly_one_frame(tmp_path) -> None:
    """What a crash mid-append leaves behind.

    JSONL was chosen over one big array precisely so this is recoverable; a
    torn array is an unreadable file.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"])
    for ts in (T0 + 5, T0 + 10):
        cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": {"S1": -60.0}}, {},
                         {"S1": "Office"}, {"S1": "main"},
                         poll_s=5.0, vote_window=4, vote_threshold=3,
                         pinned={}, coord=FakeCoord(), now=ts)
    await cap.async_flush(now=T0 + 10)
    with open(cap._path(sid), "a", encoding="utf-8") as fh:
        fh.write('{"t":"f","ts":1015.0,"o":[{"k":"k1"')   # power cut here

    page = await cap.async_read_lines(sid)
    assert page is not None
    kinds = [json.loads(x)["t"] for x in page["lines"]]
    assert kinds.count("f") == 2
    assert "hdr" in kinds


# ── who gets recorded ─────────────────────────────────────────────────────────

async def test_anonymous_ble_traffic_is_not_recorded(tmp_path) -> None:
    """Measured on a real house: ~1,800 BLE objects per poll, ~40 of them ours.

    Recording the lot produced a 250-of-1,800 sample that called itself a
    recording — the truncation cap was doing all the work and the result was a
    large arbitrary slice of the neighbourhood. Identified or followed only,
    which is the rule the traceback store already uses, and the cap goes back
    to being a backstop instead of the policy.

    It is also the difference between recording the devices being positioned
    and recording every phone that walks past the house.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"])

    mine = _obj("ble:mine", addr="AA:BB:CC:00:00:01")
    followed = {**_obj("ble:followed", addr="AA:BB:CC:00:00:02"), "identified": False}
    stranger = {**_obj("ble:stranger", addr="AA:BB:CC:00:00:03"), "identified": False}
    cap._followed = {"ble:followed"}

    cap.record_frame(
        {"ble:mine": mine, "ble:followed": followed, "ble:stranger": stranger},
        {f"AA:BB:CC:00:00:0{i}": {"S1": -60.0} for i in (1, 2, 3)},
        {}, {"S1": "Office"}, {"S1": "main"},
        poll_s=5.0, vote_window=4, vote_threshold=3,
        pinned={}, coord=FakeCoord(), now=T0 + 5)
    await cap.async_flush(now=T0 + 5)

    frame = [x for x in _lines(cap, sid) if x["t"] == "f"][0]
    assert {o["k"] for o in frame["o"]} == {"ble:mine", "ble:followed"}
    assert "tr" not in frame, "a filtered frame should not report truncation"


async def test_an_explicit_key_list_overrides_the_filter(tmp_path) -> None:
    """Diagnosing an unknown device is the case the filter would break.

    Naming a key is the operator saying "record this one whatever you think of
    it", and it has to beat every heuristic or the feature cannot be used for
    the problem people actually have.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"], keys=["ble:unknown"])

    unknown = {**_obj("ble:unknown", addr="AA:BB:CC:00:00:09"), "identified": False}
    cap.record_frame({"ble:unknown": unknown, "ble:mine": _obj("ble:mine")},
                     {"AA:BB:CC:00:00:09": {"S1": -60.0},
                      "AA:BB:CC:00:00:01": {"S1": -61.0}},
                     {}, {"S1": "Office"}, {"S1": "main"},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned={}, coord=FakeCoord(), now=T0 + 5)
    await cap.async_flush(now=T0 + 5)

    frame = [x for x in _lines(cap, sid) if x["t"] == "f"][0]
    assert {o["k"] for o in frame["o"]} == {"ble:unknown"}, (
        "an explicit key list must record exactly what it names, and nothing else")


# ── the caps ──────────────────────────────────────────────────────────────────

async def test_only_the_strongest_sources_survive_the_cap(tmp_path) -> None:
    """A 200-scanner site must not write a 200-wide vector per object per poll.

    Which 32 matters: the weakest readings are the ones a positioning fixture
    can most afford to lose, and keeping an arbitrary 32 would silently change
    what the replay sees.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    srcs = [f"S{i:03d}" for i in range(200)]
    sid = await _start(cap, srcs)
    # S000 strongest at -30, descending to S199 at -229
    vec = {s: -30.0 - i for i, s in enumerate(srcs)}
    cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": vec}, {},
                     {s: "Office" for s in srcs}, {s: "main" for s in srcs},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned={}, coord=FakeCoord(), now=T0 + 5)
    await cap.async_flush(now=T0 + 5)

    frame = [x for x in _lines(cap, sid) if x["t"] == "f"][0]
    v = frame["o"][0]["v"]
    assert len(v) == MAX_SOURCES_PER_OBJECT
    assert set(v) == {str(i) for i in range(MAX_SOURCES_PER_OBJECT)}
    assert min(v.values()) == -30.0 - (MAX_SOURCES_PER_OBJECT - 1)


async def test_a_truncated_frame_keeps_the_labelled_objects_and_says_so(tmp_path) -> None:
    """A fixture that silently sampled a site would claim to describe it.

    Ground-truth objects survive first because they are the only ones that can
    be scored at all, and the dropped count ships in the frame.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"], keys=None)
    cap.mark_ground_truth("Kitchen", ["k0500"], now=T0 + 2)

    result = {f"k{i:04d}": _obj(f"k{i:04d}", addr=f"AA:BB:CC:00:{i // 256:02X}:{i % 256:02X}")
              for i in range(600)}
    rssi = {f"AA:BB:CC:00:{i // 256:02X}:{i % 256:02X}": {"S1": -60.0} for i in range(600)}
    cap.record_frame(result, rssi, {}, {"S1": "Office"}, {"S1": "main"},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned={}, coord=FakeCoord(), now=T0 + 5)
    await cap.async_flush(now=T0 + 5)

    frame = [x for x in _lines(cap, sid) if x["t"] == "f"][0]
    assert len(frame["o"]) == MAX_OBJECTS_PER_FRAME
    assert frame["tr"] == 600 - MAX_OBJECTS_PER_FRAME
    assert any(o.get("g") == "Kitchen" for o in frame["o"]), "the labelled object was dropped"


async def test_a_session_stops_itself_at_its_deadline(tmp_path) -> None:
    cap = _make_store(tmp_path)
    await cap.async_load()
    await _start(cap, ["S1"], minutes=1)
    cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": {"S1": -60.0}}, {},
                     {"S1": "Office"}, {"S1": "main"},
                     poll_s=5.0, vote_window=4, vote_threshold=3,
                     pinned={}, coord=FakeCoord(), now=T0 + 70)
    await cap.async_maybe_flush(now=T0 + 70)
    assert cap.recording is False
    assert cap.data["sessions"][-1]["stop_reason"] == "duration"


async def test_a_session_stops_itself_at_its_byte_ceiling(tmp_path, monkeypatch) -> None:
    """Duration binds first on a small site; size binds first on a large one.

    Both have to work, or a commercial install fills a disk waiting for a clock.
    """
    cap = _make_store(tmp_path)
    await cap.async_load()
    monkeypatch.setattr(cap_mod, "MAX_SESSION_BYTES", 400)
    await _start(cap, ["S1"], minutes=60)
    for ts in (T0 + 5, T0 + 10, T0 + 15, T0 + 20):
        cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": {"S1": -60.0}}, {},
                         {"S1": "Office"}, {"S1": "main"},
                         poll_s=5.0, vote_window=4, vote_threshold=3,
                         pinned={}, coord=FakeCoord(), now=ts)
        await cap.async_maybe_flush(now=ts)
        if not cap.recording:
            break
    assert cap.recording is False
    assert cap.data["sessions"][-1]["stop_reason"] == "size_cap"


async def test_the_session_is_never_held_in_memory(tmp_path) -> None:
    """`_pending` is bounded by BYTES, not frames — the 25 MB never sits in RAM."""
    cap = _make_store(tmp_path)
    await cap.async_load()
    await _start(cap, ["S1"])
    for i in range(200):
        ts = T0 + 5 + i * 5
        cap.record_frame({"k1": _obj("k1")}, {"AA:BB:CC:00:00:01": {"S1": -60.0}}, {},
                         {"S1": "Office"}, {"S1": "main"},
                         poll_s=5.0, vote_window=4, vote_threshold=3,
                         pinned={}, coord=FakeCoord(), now=ts)
        await cap.async_maybe_flush(now=ts)
        assert cap._pending_bytes <= cap_mod.MAX_PENDING_BYTES


# ── the manifest ──────────────────────────────────────────────────────────────

async def test_a_session_interrupted_by_a_restart_is_closed_on_load(tmp_path) -> None:
    """Nothing else ever closes it, so it would read as live forever."""
    cap = _make_store(tmp_path)
    cap.store._data = {"sessions": [{"id": "20260101-000000", "t0": T0, "open": True}]}
    await cap.async_load()
    row = cap.data["sessions"][0]
    assert row["open"] is False
    assert row["stop_reason"] == "interrupted"


async def test_pruning_evicts_by_age_then_count_and_unlinks_the_files(tmp_path) -> None:
    """This store owns files, so a manifest-only prune leaks disk."""
    cap = _make_store(tmp_path)
    await cap.async_load()
    now = T0
    cap.data["sessions"] = (
        [{"id": "old", "t0": now - 86400 * 90, "bytes": 10}]
        + [{"id": f"s{i}", "t0": now - i, "bytes": 10} for i in range(20, 0, -1)]
    )
    cap._prune()
    ids = [s["id"] for s in cap.data["sessions"]]
    assert "old" not in ids, "an expired session survived"
    assert len(ids) == cap_mod.MAX_SESSIONS

    cap._seg_dir.mkdir(parents=True, exist_ok=True)
    for sid in ("s1", "orphan"):
        cap._path(sid).write_text("{}\n", encoding="utf-8")
    cap._delete_files_sync(cap._orphans())
    assert cap._path("s1").exists(), "a live session's file was deleted"
    assert not cap._path("orphan").exists(), "an evicted session leaked its file"


async def test_clearing_removes_the_files_not_just_the_index(tmp_path) -> None:
    cap = _make_store(tmp_path)
    await cap.async_load()
    sid = await _start(cap, ["S1"])
    await cap.async_stop("manual", now=T0 + 10)
    assert cap._path(sid).exists()

    removed = await cap.async_clear()
    assert removed == 1
    assert not cap._path(sid).exists()
    assert cap.data["sessions"] == []
