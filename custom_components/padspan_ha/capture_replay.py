# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""Replay a recorded RSSI-vector capture through the live smoothing pipeline.

This is the payoff for capture_store.py, and the reason it exists: until this
module, every positioning tuning change was argued from memory — a room felt
stickier, a floor flipped less — because there was no way to run yesterday's
radio conditions through today's code and get back a number instead of an
impression. A capture makes the input reproducible; this module is what turns
that into a scored comparison.

Originally lived only in tests/test_capture_replay.py, which is where these
functions were proven correct against a real CaptureStore. Promoted here
(gap #13, best-in-class roadmap) so ws_capture.py can offer the SAME replay
as a real feature — "Replay & Score" and settings A/B on a finished session —
rather than a pytest-only regression tool. Behaviour is unchanged from the
test version; the test file now imports these instead of duplicating them.

Runs entirely against an ISOLATED PresenceCoordinator built from the
capture's own recorded header (see build_coordinator) — never the live one —
so a replay triggered from the UI can never disturb a running install's own
Kalman/vote state.

Two assertion modes, and the recorded frame supports both deliberately:

  GOLDEN REGRESSION   replayed room == the frame's own `r`. A refactor that
                      changes a single answer fails here. This works because
                      the inputs and the output are recorded side by side.

  ACCURACY BENCHMARK  replayed room == the frame's `g` (the operator's
                      ground-truth room label), over the frames a human
                      walked and labelled. This is the one that makes a
                      tuning change measurable instead of anecdotal.

score_replay additionally compares each frame's own recorded position
(`mx`/`my`) against a ground-truth POSITION (`gx`/`gy`, from an optional
x_m/y_m on capture_mark) when present — a real "how far off was the live
system" metre-error number. It does NOT re-solve position: the spatial
locate step lives inside PresenceCoordinator's full poll loop, not inside
the replayable _smooth_room path, so a settings A/B here only ever moves the
ROOM-accuracy number, not the metre one. Re-solving position under changed
settings would need that step extracted the same way _smooth_room already
was — a larger, separate piece of work, not started here.
"""

import json
import math
from collections import deque
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from .const import DATA_SETTINGS, DOMAIN


def load_capture(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return (header, frames) from an exported capture .jsonl.

    Vectors come back keyed by SCANNER NAME again — the on-disk source index
    is a storage detail and no consumer should have to know it. `env` deltas
    are applied in order as they are encountered, which is what makes a
    session that gained a radio mid-recording load correctly.

    Ground truth (room `g`, and position `gx`/`gy` when the operator marked
    one) is already embedded per-object by the recorder — capture_store.py's
    `_object_record` writes it onto every frame while `_gt_room`/`_gt_x_m`/
    `_gt_y_m` stay set, so this loader does not need its own `gt`-line state
    machine; it only needs to resolve source indices.
    """
    from .capture_store import SCHEMA_VERSION

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


def build_coordinator(header: dict[str, Any]):
    """A coordinator wired to the recorded settings and geometry.

    _smooth_room re-reads Q, R, ref_power and the rest from the live settings
    store on every call, so replaying under today's settings instead of the
    recorded ones silently compares two different pipelines. A MagicMock
    hass is enough — nothing here calls into HA itself, only pure attributes
    _smooth_room reads directly off the coordinator.
    """
    from .presence_coordinator import PresenceCoordinator

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


def seed_warm_state(coord, key: str, addr: str, w: dict[str, Any]) -> None:
    """Restore the filter state the recording started from.

    `w` is the state AFTER its own frame's update — i.e. exactly what the
    next frame consumed. A replay therefore seeds from a key's first frame
    and scores from its second, which costs one frame and makes the
    comparison exact instead of warm-up biased.
    """
    coord._ema_rssi[addr] = dict(w.get("ema") or {})
    coord._kalman_p[addr] = dict(w.get("p") or {})
    coord._silence_miss[addr] = {k: int(v) for k, v in (w.get("m") or {}).items()}
    if w.get("vt"):
        coord._room_votes[key] = deque(w["vt"], maxlen=max(len(w["vt"]), 1))
    if w.get("r"):
        coord._confirmed_room[key] = w["r"]


def replay(header: dict[str, Any], frames: list[dict[str, Any]],
           coord=None) -> list[dict[str, Any]]:
    """Re-run the recorded trace through _smooth_room.

    Returns one row per (frame, object) from the SECOND frame of each key on,
    each carrying what the pipeline says now (`got`), what it said when
    recorded (`want`), the human's room label if there was one (`truth`),
    and the human's position mark if there was one (`truth_x_m`/`truth_y_m`)
    alongside the ORIGINAL run's own solved position (`mx`/`my`) for
    score_replay's metre-error pass.

    Pinned objects are reported as `pinned` and excluded from `want`: a pin
    overrides the pipeline after _smooth_room returns, so the recorded `r`
    for a pinned beacon is the pin, not an answer the pipeline ever gave.
    Scoring it as one fails every assertion for a reason nobody would find.
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
                "truth_x_m": obj.get("gx"),
                "truth_y_m": obj.get("gy"),
                "mx": obj.get("mx"),
                "my": obj.get("my"),
                "pinned": obj.get("p"),
                "conf": coord._room_confidence.get(key, 0.0),
            })
    return out


def score_replay(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Accuracy summary from replay() rows (gap #13, best-in-class roadmap).

    Room accuracy: fraction of ground-truth-labelled rows where the replay's
    own answer (`got`) matches the operator's label (`truth`) — the number a
    room-smoothing settings change (kalman_q/r, room_change_delay_s, ...)
    actually moves.

    Metre accuracy: distance between the pipeline's OWN recorded position
    for that frame (`mx`/`my`, from the ORIGINAL run) and the operator's
    asserted true position (`truth_x_m`/`truth_y_m`). This does not re-solve
    position — see the module docstring — so it measures how far off the
    original run was, not how a settings change affects position. Frames
    with no position mark are skipped rather than guessed at.
    """
    room_scored = [r for r in rows if r.get("truth")]
    room_correct = [r for r in room_scored if r["got"] == r["truth"]]
    room_accuracy = round(len(room_correct) / len(room_scored), 3) if room_scored else None

    errors_m: list[float] = []
    for r in rows:
        if r.get("truth_x_m") is None or r.get("truth_y_m") is None:
            continue
        if r.get("mx") is None or r.get("my") is None:
            continue
        errors_m.append(math.sqrt(
            (r["mx"] - r["truth_x_m"]) ** 2 + (r["my"] - r["truth_y_m"]) ** 2
        ))
    errors_m.sort()

    return {
        "room_accuracy": room_accuracy,
        "room_scored_count": len(room_scored),
        "mean_error_m": round(sum(errors_m) / len(errors_m), 3) if errors_m else None,
        "median_error_m": round(errors_m[len(errors_m) // 2], 3) if errors_m else None,
        "max_error_m": round(errors_m[-1], 3) if errors_m else None,
        "position_scored_count": len(errors_m),
    }
