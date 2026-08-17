# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Replay a recorded trace through the live smoothing pipeline.

This is the payoff for the capture store, and the reason it exists. Until now
every positioning change was argued from memory — a room felt stickier, a floor
flipped less — because there was no way to run yesterday's radio conditions
through today's code. A capture makes the input reproducible, so the same walk
can be scored before and after a change and the difference stated as a number.

Two assertion modes, and the recorded frame supports both deliberately:

  GOLDEN REGRESSION   replayed room == the frame's own `r`. A refactor that
                      changes a single answer fails here. This works because
                      the inputs and the output are recorded side by side.

  ACCURACY BENCHMARK  replayed room == the frame's `g`, over the frames a human
                      labelled. This is the one that makes a tuning change
                      measurable instead of anecdotal.

`load_capture` and `replay` are public so a future tuning test can import them
and score a real exported trace without re-deriving any of this.

No real trace is committed. A capture contains this house's scanner MACs, its
device MACs, its room names and its device labels, and a real trace in git
history cannot be taken back out. The fixtures here are synthetic and built in
the test; scrubbing and committing a real one stays available and is a separate,
deliberate decision.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha.capture_store import SCHEMA_VERSION, CaptureStore
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator

from tests.conftest import MockHass, MockStore

# See test_capture_store: retention is measured against the wall clock.
import time

T0 = time.time()


# ── loader ────────────────────────────────────────────────────────────────────

def load_capture(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return (header, frames) from an exported capture .jsonl.

    Vectors come back keyed by SCANNER NAME again — the on-disk source index is
    a storage detail and no consumer should have to know it. `env` deltas are
    applied in order as they are encountered, which is what makes a session
    that gained a radio mid-recording load correctly.

    Ground truth is carried forward from each `gt` marker onto the frames that
    follow it, so a caller sees one flat list rather than a state machine.
    """
    header: dict[str, Any] = {}
    frames: list[dict[str, Any]] = []
    src: list[str] = []

    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        try:
            rec = json.loads(raw)
        except ValueError:
            continue  # torn tail from a crash mid-append
        kind = rec.get("t")
        if kind == "hdr":
            if int(rec.get("sv") or 0) != SCHEMA_VERSION:
                raise ValueError(
                    f"capture schema v{rec.get('sv')} but this loader speaks v{SCHEMA_VERSION}")
            header = rec
            src = list(rec.get("src") or [])
        elif kind == "env":
            if "src" in rec:
                src = list(rec["src"])
            for k in ("s2a", "s2f"):
                if k in rec:
                    header[k] = rec[k]
        elif kind == "f":
            frame = dict(rec)
            frame["o"] = [_resolve(o, src) for o in (rec.get("o") or [])]
            frames.append(frame)
    if not header:
        raise ValueError("no header line — not a capture file")
    return header, frames


def _resolve(obj: dict[str, Any], src: list[str]) -> dict[str, Any]:
    out = dict(obj)
    for field in ("v", "e"):
        if field in out:
            out[field] = {src[int(i)]: v for i, v in out[field].items() if int(i) < len(src)}
    if "w" in out:
        w = dict(out["w"])
        for field in ("ema", "p", "m"):
            if field in w:
                w[field] = {src[int(i)]: v for i, v in w[field].items() if int(i) < len(src)}
        out["w"] = w
    return out


# ── replay ────────────────────────────────────────────────────────────────────

def build_coordinator(header: dict[str, Any]) -> PresenceCoordinator:
    """A coordinator wired to the recorded settings and geometry.

    _smooth_room re-reads Q, R, ref_power and the rest from the live settings
    store on every call, so replaying under today's settings instead of the
    recorded ones silently compares two different pipelines.
    """
    hass = MagicMock()
    settings = MagicMock()
    settings.data = dict(header.get("set") or {})
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}

    coord = PresenceCoordinator(hass)
    coord._pending_room_changes = []
    coord._scanner_positions = {
        s: (p["x_m"], p["y_m"], p.get("floor_id", ""))
        for s, p in (header.get("pos") or {}).items()
    }
    coord._room_centroids = {r: tuple(c) for r, c in (header.get("cent") or {}).items()}
    coord._floor_bounds = dict(header.get("fb") or {})
    coord._use_metres = bool(header.get("um"))
    coord._pl_fits = dict(header.get("plf") or {})
    return coord


def seed_warm_state(coord: PresenceCoordinator, key: str, addr: str, w: dict[str, Any]) -> None:
    """Restore the filter state the recording started from.

    `w` is the state AFTER its own frame's update — i.e. exactly what the next
    frame consumed. A replay therefore seeds from a key's first frame and
    scores from its second, which costs one frame and makes the comparison
    exact instead of warm-up biased.
    """
    coord._ema_rssi[addr] = dict(w.get("ema") or {})
    coord._kalman_p[addr] = dict(w.get("p") or {})
    coord._silence_miss[addr] = {k: int(v) for k, v in (w.get("m") or {}).items()}
    if w.get("vt"):
        coord._room_votes[key] = deque(w["vt"], maxlen=max(len(w["vt"]), 1))
    if w.get("r"):
        coord._confirmed_room[key] = w["r"]


def replay(header: dict[str, Any], frames: list[dict[str, Any]],
           coord: PresenceCoordinator | None = None) -> list[dict[str, Any]]:
    """Re-run the recorded trace through _smooth_room.

    Returns one row per (frame, object) from the SECOND frame of each key on,
    each carrying what the pipeline said now (`got`), what it said when
    recorded (`want`), and the human's label if there was one (`truth`).

    Pinned objects are reported as `pinned` and excluded from `want`: a pin
    overrides the pipeline after _smooth_room returns, so the recorded `r` for
    a pinned beacon is the pin, not an answer the pipeline ever gave. Scoring
    it as one fails every assertion for a reason nobody would find.
    """
    coord = coord or build_coordinator(header)
    s2a = dict(header.get("s2a") or {})
    s2f = dict(header.get("s2f") or {})
    rooms = set(header.get("rooms") or ())
    vw = int(header.get("vw") or 1)
    vt = int(header.get("vt") or 1)
    seeded: set[str] = set()
    out: list[dict[str, Any]] = []

    for frame in frames:
        vw = int(frame.get("vw", vw))
        vt = int(frame.get("vt", vt))
        for obj in frame.get("o") or []:
            key, addr = obj["k"], obj["a"]
            if key not in seeded:
                seeded.add(key)
                seed_warm_state(coord, key, addr, obj.get("w") or {})
                continue   # its inputs produced the state we just seeded
            got = coord._smooth_room(key, addr, {addr: obj.get("v") or {}},
                                     s2a, vw, vt, s2f, rooms)
            out.append({
                "ts": frame["ts"], "k": key,
                "got": got,
                "want": obj.get("r") if "p" not in obj else None,
                "truth": obj.get("g"),
                "pinned": obj.get("p"),
                "conf": coord._room_confidence.get(key, 0.0),
            })
    return out


# ── a synthetic recording, made the way a real one is ─────────────────────────

_SRCS = ["scan_office", "scan_kitchen", "scan_hall"]
_AREA = {"scan_office": "Office", "scan_kitchen": "Kitchen", "scan_hall": "Hall"}
_FLOOR = {s: "main" for s in _SRCS}


def _header() -> dict[str, Any]:
    return {
        "t": "hdr", "sv": SCHEMA_VERSION, "ver": "test", "dm": "sample",
        "poll_s": 5.0, "vw": 2, "vt": 2,
        "rooms": ["Office", "Kitchen", "Hall"],
        "set": {"kalman_q": 0.125, "kalman_r": 8.0, "room_change_delay_s": 10.0},
        "um": False, "pos": {}, "cent": {}, "fb": {}, "plf": {},
    }


_DWELL = 15   # polls per room


def _walk() -> list[tuple[float, dict[str, float]]]:
    """Stand in the office, walk to the kitchen, stand there.

    Fifteen polls a side rather than a token few: the pipeline deliberately
    lags a room change by the vote window, so a walk short enough for that lag
    to be a large fraction of the sample measures the vote window, not the
    positioning. Seventy-five seconds a room is also what somebody actually
    records.
    """
    office = {"scan_office": -55.0, "scan_kitchen": -80.0, "scan_hall": -72.0}
    kitchen = {"scan_office": -82.0, "scan_kitchen": -54.0, "scan_hall": -70.0}
    return ([(T0 + 5 * i, dict(office)) for i in range(1, _DWELL + 1)]
            + [(T0 + 5 * i, dict(kitchen)) for i in range(_DWELL + 1, 2 * _DWELL + 1)])


async def _record(tmp_path: Path, *, ground_truth: bool = False,
                  pinned: dict[str, dict[str, Any]] | None = None) -> Path:
    """Drive a real CaptureStore with a real coordinator over a synthetic walk.

    Deliberately not a hand-written .jsonl: the point of the fixture is that
    the recorder and the loader agree, and a hand-written file would only prove
    the loader agrees with me.
    """
    hass = MagicMock()
    settings = MagicMock()
    settings.data = dict(_header()["set"])
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}
    coord = PresenceCoordinator(hass)
    coord._pending_room_changes = []

    cap = CaptureStore(MockHass(tmp_path))
    cap.store = MockStore()
    await cap.async_load()
    sid = cap.start_session(_header(), minutes=60, sources=list(_SRCS),
                            source_to_area=dict(_AREA), source_to_floor=dict(_FLOOR),
                            now=T0)

    addr = "AA:BB:CC:DD:EE:01"
    key = f"ble:{addr}"
    for ts, vec in _walk():
        if ground_truth:
            room = "Office" if ts <= T0 + 5 * _DWELL else "Kitchen"
            if (cap._gt_room or "") != room:
                cap.mark_ground_truth(room, now=ts)
        # The coordinator runs first — the hook records what the poll produced.
        got = coord._smooth_room(key, addr, {addr: vec}, dict(_AREA), 2, 2,
                                 dict(_FLOOR), {"Office", "Kitchen", "Hall"})
        obj = {"key": key, "kind": "ble", "address": addr, "identified": True,
               "room": got or "", "room_confidence": coord._room_confidence.get(key, 0.0)}
        if pinned and key in pinned:
            obj["room"] = pinned[key]["room"]
        cap.record_frame({key: obj}, {addr: vec}, {}, dict(_AREA), dict(_FLOOR),
                         poll_s=5.0, vote_window=2, vote_threshold=2,
                         pinned=pinned or {}, coord=coord, now=ts)
    await cap.async_stop("manual", now=T0 + 5 * (2 * _DWELL + 1))
    return cap._path(sid)


# ── tests ─────────────────────────────────────────────────────────────────────

async def test_a_recorded_session_loads_back_as_frames(tmp_path) -> None:
    """The round trip. If this breaks, every fixture in the suite is unreadable."""
    header, frames = load_capture(await _record(tmp_path))

    assert header["sv"] == SCHEMA_VERSION
    assert header["s2a"] == _AREA
    assert len(frames) == 2 * _DWELL
    # Vectors come back by scanner NAME — the index never reaches a consumer.
    v = frames[0]["o"][0]["v"]
    assert set(v) <= set(_SRCS)
    assert v["scan_office"] == pytest.approx(-55.0)


async def test_the_loader_refuses_a_schema_it_does_not_speak(tmp_path) -> None:
    """A fixture recorded by a future build must fail loudly, not silently.

    Reading a v2 frame as v1 gives you numbers, and numbers that are wrong in
    a way nobody checks are worse than an exception.
    """
    path = await _record(tmp_path)
    lines = path.read_text(encoding="utf-8").splitlines()
    hdr = json.loads(lines[0])
    hdr["sv"] = SCHEMA_VERSION + 1
    path.write_text("\n".join([json.dumps(hdr)] + lines[1:]) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="schema"):
        load_capture(path)


async def test_a_replay_reproduces_the_recorded_answers_exactly(tmp_path) -> None:
    """GOLDEN REGRESSION — the mode that catches an unintended change.

    Same inputs, same settings, same warm state, therefore the same rooms. A
    refactor of the smoothing pipeline that moves one answer fails here, which
    is the whole point of recording the outputs beside the inputs.
    """
    header, frames = load_capture(await _record(tmp_path))
    rows = replay(header, frames)

    assert rows, "nothing was replayed"
    wrong = [r for r in rows if r["want"] is not None and r["got"] != r["want"]]
    assert not wrong, f"{len(wrong)}/{len(rows)} frames diverged: {wrong[:3]}"


async def test_a_replay_scores_itself_against_the_human_labels(tmp_path) -> None:
    """ACCURACY BENCHMARK — the mode that makes a tuning change measurable.

    The floors below are the MEASURED baseline of this trace, not aspirations.
    Today it scores 23/29 with a six-poll lag, and every miss is that lag: the
    walk switches rooms in a single poll, so the Kalman has to chase a 27 dB
    step no real doorway produces. That is the pipeline behaving as designed,
    and writing the number down is the point — the next tuning change either
    moves it or it does not.
    """
    header, frames = load_capture(await _record(tmp_path, ground_truth=True))
    rows = [r for r in replay(header, frames) if r["truth"]]

    assert rows, "no ground-truth frames — the marker never reached the file"
    hit = sum(1 for r in rows if r["got"] == r["truth"])
    assert hit / len(rows) >= 0.75, (
        f"room accuracy {hit}/{len(rows)} against the operator's labels")

    # Transition latency: polls from the operator's label changing to the
    # pipeline agreeing. This is the number a stickiness change moves in the
    # opposite direction to accuracy, so measuring only one of the two is how
    # a tuning change gets called an improvement when it was a trade.
    switch = next(i for i, r in enumerate(rows) if r["truth"] == "Kitchen")
    agreed = next(i for i, r in enumerate(rows) if i >= switch and r["got"] == "Kitchen")
    assert agreed - switch <= 7, f"took {agreed - switch} polls to follow the walk"


async def test_a_pinned_beacon_is_never_scored_against_its_pin(tmp_path) -> None:
    """The trap this record shape exists to disarm.

    A pin overrides the pipeline AFTER _smooth_room returns, so a pinned
    beacon's recorded room is the pin. Scored as a pipeline answer it fails
    100% of its frames, and the cause is nowhere near the symptom.
    """
    pinned = {"ble:AA:BB:CC:DD:EE:01": {"room": "Garage"}}
    header, frames = load_capture(await _record(tmp_path, pinned=pinned))
    rows = replay(header, frames)

    assert rows
    assert all(r["pinned"] == "Garage" for r in rows)
    assert all(r["want"] is None for r in rows), "a pin was offered up as a pipeline answer"
    # And the recorded room really was the pin, which is why it must be excluded.
    assert all(o.get("r") == "Garage" for f in frames for o in f["o"])


async def test_warm_state_is_carried_so_the_replay_does_not_start_cold(tmp_path) -> None:
    """The single field the existing traceback could not provide.

    A session starts with the coordinator warm. Replaying from a cold filter
    diverges for the first several frames and every assertion in that window is
    noise — which is exactly why the traceback store could not be used as a
    replay source and this store had to exist.
    """
    header, frames = load_capture(await _record(tmp_path))
    first = frames[0]["o"][0]

    assert "w" in first, "the first frame carries no warm state"
    assert first["w"]["ema"], "the filter state was recorded empty"
    assert set(first["w"]["ema"]) <= set(_SRCS)
    # And only once per key — repeating it every frame is pure duplication.
    assert all("w" not in o for f in frames[1:] for o in f["o"])
