# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
RSSI vector capture — session-scoped recorder for offline replay.

Every tuning change to the positioning pipeline is currently argued from
memory: a room felt stickier, a floor flipped less.  This store records the
INPUT the pipeline actually consumed — the full {scanner: rssi} vector per
tracked object per poll — alongside the answer it produced, so the same trace
can be re-run offline against changed code and the difference measured instead
of recalled.

It is an observer.  Nothing here feeds back into positioning, and the
coordinator's poll is its only clock: no timer, no always-on mode, nothing
written until an operator starts a session.  Off by default
(`rssi_capture_enabled`), capped at 60 minutes and 25 MB per session.

Sessions live in .storage/padspan_ha.capture_sessions/<session_id>.jsonl,
one JSON record per line, appended in place — never rewritten.  The blob
Store holds only the manifest index, so a 25 MB session never sits in RAM
and a torn tail from a crash costs exactly one frame (see async_read_lines).

Line kinds, discriminated by "t":

  hdr  once, first line — schema version, geometry, and every setting the
       smoothing pipeline re-reads live.  Includes "src", the SOURCE INDEX:
       vectors are keyed by position in that array, not by scanner name, which
       is what keeps a 200-scanner site affordable.  Append-only for the life
       of the session, so an index once written never changes meaning.
  env  a mid-session change to src / s2a / s2f (auto mode writes new radios
       back while recording).  Only the changed keys are present.
  gt   an operator's ground-truth assertion: "this device is in this room now".
  f    a frame — one poll.  Inputs (v, x, e, w) and outputs (r, c, mx/my/mf, q, p).
  end  once, last line — frame count and why the session stopped.

Timestamps are epoch seconds throughout.  The coordinator's poll clock is
time.monotonic(), which is meaningless across a restart, so record_frame reads
the wall clock itself.

Field-by-field meaning is in the header/frame builders below.  The one that
needs stating up front is `w`, the warm filter state: it is the state AFTER
this frame's update, i.e. exactly what the NEXT frame consumed.  A replay
therefore seeds from the first frame's `w` and scores from the second frame
on.  That costs one frame and makes the replay exact rather than warm-up
biased, which was the whole reason the existing traceback could not be used.
"""

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import CAPTURE_STORE_KEY, VERSION

_LOGGER = logging.getLogger(__name__)

SCHEMA_VERSION = 1              # bumped when a line shape changes; fixtures assert on it
SESSION_DIR = "padspan_ha.capture_sessions"

# ── Within one session ────────────────────────────────────────────────────────
DEFAULT_SESSION_S = 300         # 5 min — long enough to walk a floor
MAX_SESSION_S = 3600            # 60 min hard ceiling
MAX_SESSION_BYTES = 25 * 1024 * 1024
MAX_SOURCES_PER_OBJECT = 32     # strongest kept; bounds a 200-scanner site
MAX_OBJECTS_PER_FRAME = 250     # bounds a 2000-object site
MIN_FRAME_INTERVAL_S = 1.0      # safety rate gate (traceback uses 8)

# ── Across sessions ───────────────────────────────────────────────────────────
MAX_SESSIONS = 10
MAX_TOTAL_BYTES = 200 * 1024 * 1024
RETENTION_CHOICES = (1, 3, 7, 14, 30)
DEFAULT_RETENTION_DAYS = 14

# ── Flush pacing ──────────────────────────────────────────────────────────────
# Traceback flushes every 30 s; 10 s bounds a crash to two lost frames at the
# 5 s poll.  Appends, not rewrites — the SD-card wear that forced traceback
# append-only in the first place is about full rewrites.
FLUSH_INTERVAL_S = 10
MAX_PENDING_BYTES = 2 * 1024 * 1024   # forces a flush regardless of interval
MAX_PAGE_BYTES = 1_500_000            # cap on one capture_get response

_LABEL_MAX = 60
_CAL_POINTS_MAX = 5000


def build_header(
    hass: HomeAssistant,
    coord: Any,
    *,
    label: str = "",
    poll_s: float = 5.0,
    vote_window: int = 1,
    vote_threshold: int = 1,
    fabric_rooms: set[str] | None = None,
    include_calibration: bool = False,
    now: float | None = None,
) -> dict[str, Any]:
    """Snapshot everything a replay needs that is not per-frame.

    A module function rather than a method so a test can build a header from a
    fake coordinator without an HA instance in the loop.

    The settings block matters more than it looks: _smooth_room re-reads Q, R,
    ref_power, path-loss exponent and the rest from the live settings store on
    EVERY call.  A replay under different settings is a different pipeline, so
    they are pinned here and the loader compares them.
    """
    from .const import (
        DATA_CALIBRATION,
        DATA_SETTINGS,
        DOMAIN,
    )

    domain = hass.data.get(DOMAIN, {}) or {}
    settings = dict(((domain.get(DATA_SETTINGS) or None) and domain[DATA_SETTINGS].data) or {})

    hdr: dict[str, Any] = {
        "t": "hdr",
        "sv": SCHEMA_VERSION,
        "ts": round(float(now if now is not None else time.time()), 2),
        "lbl": str(label or "")[:_LABEL_MAX],
        "ver": VERSION,
        # A sample-mode trace is synthetic. Recording it is allowed — it is how
        # the replay harness itself gets tested — but the loader must be able to
        # tell, or a fixture that looks real and is not enters the suite.
        "dm": str(settings.get("data_mode") or "sample"),
        "poll_s": round(float(poll_s), 3),
        "vw": int(vote_window),
        "vt": int(vote_threshold),
        "src": [],          # filled by start_session from the live source set
        "s2a": {},
        "s2f": {},
        "rooms": sorted(fabric_rooms or ()),
    }

    # Geometry — the spatial path's entire world.
    hdr["pos"] = {
        str(src): {"x_m": _round(p[0], 3), "y_m": _round(p[1], 3),
                   "floor_id": str(p[2] if len(p) > 2 else "")}
        for src, p in (getattr(coord, "_scanner_positions", None) or {}).items()
    }
    hdr["absz"] = {str(k): _round(v, 3)
                   for k, v in (getattr(coord, "_scanner_abs_z", None) or {}).items()}
    hdr["cent"] = {str(r): [_round(c[0], 3), _round(c[1], 3)]
                   for r, c in (getattr(coord, "_room_centroids", None) or {}).items()
                   if isinstance(c, (list, tuple)) and len(c) >= 2}
    hdr["fb"] = _jsonable(getattr(coord, "_floor_bounds", None) or {})
    hdr["fbase"] = _jsonable(getattr(coord, "_floor_bases", None) or {})
    hdr["fstack"] = _jsonable(getattr(coord, "_floor_stack_idx", None) or {})
    # The coverage floor the outside rule ran against, and where it came from,
    # so a replay reproduces the decision (docs/outside-attribution-plan.md).
    hdr["cov_floor"] = getattr(coord, "_coverage_floor", None)
    hdr["cov_floor_src"] = getattr(coord, "_coverage_floor_src", "")
    hdr["bar"] = _jsonable(getattr(coord, "_rf_barriers", None) or [])
    hdr["um"] = bool(getattr(coord, "_use_metres", False))
    hdr["plf"] = _jsonable(getattr(coord, "_pl_fits", None) or {})

    # Calibration: a FINGERPRINT by default, not the points.  The failure this
    # exists to catch is "calibration was edited between recording and replay",
    # and a hash detects that for 50 bytes.  The points themselves only matter
    # when the fixture must stand alone, which is what include_calibration is for.
    points: list[Any] = []
    try:
        cal = domain.get(DATA_CALIBRATION)
        points = list((getattr(cal, "data", None) or {}).get("points") or [])
    except Exception:
        points = []
    hdr["cal"] = {"n": len(points), "sha1": _fingerprint(points)}
    if include_calibration and points:
        hdr["calp"] = _jsonable(points[:_CAL_POINTS_MAX])

    hdr["set"] = {
        k: _jsonable(settings.get(k))
        for k in (
            "kalman_q", "kalman_r", "ref_power", "path_loss_exp",
            "assumed_device_height_m", "adaptive_floor_detection",
            "adaptive_learning_enabled", "room_change_delay_s",
            "presence_poll_interval_s", "positioning_algorithm",
            "excluded_scanners", "lost_radios", "disabled_radios",
            "scanner_offsets", "ble_max_age_s", "signal_loss_linger_s",
        )
        if k in settings
    }
    return hdr


def _fingerprint(points: list[Any]) -> str:
    """Stable hash of the calibration point set, order-independent."""
    try:
        blob = json.dumps(points, sort_keys=True, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        return ""
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def _round(v: Any, nd: int) -> Any:
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return v


def _jsonable(v: Any) -> Any:
    """Coerce coordinator state into something json.dumps will accept.

    Geometry arrives as tuples, sets and occasionally deques.  A capture that
    raises inside json.dumps takes the poll's try/except with it and the
    operator sees a session that records nothing, so this is deliberately
    total rather than strict.
    """
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [_jsonable(x) for x in v]
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return str(v)


class CaptureStore:
    """Session-scoped recorder.  See the module docstring for the file format."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, CAPTURE_STORE_KEY)   # manifest ONLY, never frames
        self.data: dict[str, Any] = {"sessions": []}
        self._pending: list[str] = []          # serialized lines awaiting a flush
        self._pending_bytes: int = 0
        self._session: dict[str, Any] | None = None
        self._ends_ts: float = 0.0
        self._last_frame_ts: float = 0.0
        self._last_flush_ts: float = 0.0
        self._src_index: dict[str, int] = {}
        self._src_list: list[str] = []
        self._s2a: dict[str, str] = {}
        self._s2f: dict[str, str] = {}
        self._gt_room: str = ""
        self._gt_keys: set[str] | None = None   # None = every object
        self._session_keys: set[str] | None = None
        self._followed: set[str] = set()
        self._warmed: set[str] = set()
        self._vw: int = 0
        self._vt: int = 0
        self._poll_s: float = 0.0
        self._stop_reason: str = ""
        self._seg_dir = Path(hass.config.path(".storage", SESSION_DIR))

    # ── lifecycle ─────────────────────────────────────────────────────────────

    @property
    def recording(self) -> bool:
        return self._session is not None

    async def async_load(self) -> None:
        loaded = await self.store.async_load()
        sessions = (loaded.get("sessions") or []) if isinstance(loaded, dict) else []
        self.data = {"sessions": [s for s in sessions if isinstance(s, dict)]}
        # A session left open by a restart is closed here rather than left to
        # look live forever.  Its file is intact JSONL up to the last flush.
        dirty = False
        for s in self.data["sessions"]:
            if s.get("open"):
                s["open"] = False
                s["stop_reason"] = "interrupted"
                dirty = True
        self._prune()
        if dirty:
            await self.store.async_save(self.data)
        _LOGGER.debug("CaptureStore loaded (%d sessions)", len(self.data["sessions"]))

    def start_session(
        self,
        header: dict[str, Any],
        *,
        minutes: int = 5,
        label: str = "",
        keys: list[str] | None = None,
        followed: set[str] | None = None,
        sources: list[str] | None = None,
        source_to_area: dict[str, str] | None = None,
        source_to_floor: dict[str, str] | None = None,
        now: float | None = None,
    ) -> str:
        """Open a session and queue its header line.  Sync — no disk yet."""
        ts = float(now if now is not None else time.time())
        session_id = time.strftime("%Y%m%d-%H%M%S", time.localtime(ts))

        self._src_list = [str(s) for s in (sources or [])]
        self._src_index = {s: i for i, s in enumerate(self._src_list)}
        self._s2a = dict(source_to_area or {})
        self._s2f = dict(source_to_floor or {})
        self._session_keys = {str(k) for k in keys} if keys else None
        self._followed = {str(f).upper() for f in (followed or ())} | {str(f) for f in (followed or ())}
        self._gt_room = ""
        self._gt_keys = None
        self._warmed = set()
        self._last_frame_ts = 0.0
        self._last_flush_ts = ts
        self._stop_reason = ""
        self._vw = int(header.get("vw") or 0)
        self._vt = int(header.get("vt") or 0)
        self._poll_s = float(header.get("poll_s") or 0.0)

        hdr = dict(header)
        hdr["sid"] = session_id
        hdr["t0"] = round(ts, 2)
        hdr["src"] = list(self._src_list)
        hdr["s2a"] = dict(self._s2a)
        hdr["s2f"] = dict(self._s2f)

        self._session = {
            "id": session_id,
            "t0": round(ts, 2),
            "label": str(label or "")[:_LABEL_MAX],
            "ver": hdr.get("ver", VERSION),
            "dm": hdr.get("dm", ""),
            "frames": 0,
            "objects": 0,
            "truncated": 0,
            "bytes": 0,
            "keys": sorted(self._session_keys) if self._session_keys else [],
            "names": {},
            "open": True,
        }
        self._ends_ts = ts + min(max(1, int(minutes)) * 60, MAX_SESSION_S)
        self._pending = []
        self._pending_bytes = 0
        self._append(hdr)
        return session_id

    async def async_stop(self, reason: str = "manual", now: float | None = None) -> dict[str, Any]:
        if self._session is None:
            return {}
        ts = float(now if now is not None else time.time())
        sess = self._session
        self._append({"t": "end", "ts": round(ts, 2),
                      "frames": sess["frames"], "stop_reason": reason})
        await self.async_flush()

        sess["open"] = False
        sess["t1"] = round(ts, 2)
        sess["stop_reason"] = reason
        sess["bytes"] = await self.hass.async_add_executor_job(
            self._stat_sync, self._path(sess["id"]))
        self._session = None
        self._stop_reason = ""

        self.data.setdefault("sessions", []).append(sess)
        self._prune()
        await self.store.async_save(self.data)
        await self.hass.async_add_executor_job(self._delete_files_sync, self._orphans())
        _LOGGER.debug("Capture session %s stopped (%s, %d frames, %d bytes)",
                      sess["id"], reason, sess["frames"], sess["bytes"])
        return dict(sess)

    # ── recording ─────────────────────────────────────────────────────────────

    def record_frame(
        self,
        result: dict[str, dict[str, Any]],
        addr_src_rssi: dict[str, dict[str, float]],
        rpa_map: dict[str, str],
        source_to_area: dict[str, str],
        source_to_floor: dict[str, str],
        *,
        poll_s: float,
        vote_window: int,
        vote_threshold: int,
        pinned: dict[str, dict[str, Any]],
        followed: set[str] | None = None,
        coord: Any = None,
        now: float | None = None,
    ) -> bool:
        """Record one poll.  Sync, and it copies everything it keeps.

        `result` is this poll's live objects with their final room already
        stamped; grace-period carry-forwards are appended by the coordinator
        AFTER this hook and are correctly absent — they have no live vector and
        must never enter a replay fixture.

        Returns True when a frame was written.
        """
        if self._session is None:
            return False
        ts = float(now if now is not None else time.time())
        if self._last_frame_ts and ts - self._last_frame_ts < MIN_FRAME_INTERVAL_S:
            return False
        if followed is not None:
            # Live setting — a device followed mid-session starts being recorded
            # from the next poll rather than at the next session.
            self._followed = {str(f).upper() for f in followed} | {str(f) for f in followed}
        dt = round(ts - self._last_frame_ts, 2) if self._last_frame_ts else 0.0
        self._last_frame_ts = ts

        self._emit_env(source_to_area, source_to_floor, addr_src_rssi, ts)

        records: list[dict[str, Any]] = []
        for key, obj in result.items():
            rec = self._object_record(key, obj, addr_src_rssi, rpa_map, pinned, coord)
            if rec is not None:
                records.append(rec)

        dropped = 0
        if len(records) > MAX_OBJECTS_PER_FRAME:
            records.sort(key=_object_rank, reverse=True)
            dropped = len(records) - MAX_OBJECTS_PER_FRAME
            records = records[:MAX_OBJECTS_PER_FRAME]

        # Labels are lifted out to the manifest BEFORE the frame is serialized.
        # Doing it afterwards writes a 30-character device name into every
        # object of every frame — at 40 objects over an hour that is megabytes
        # of the same string, which is the repetition this field exists to
        # avoid rather than commit.
        for rec in records:
            name = rec.pop("_n", "")
            if name:
                self._session["names"].setdefault(rec["k"], name)

        frame: dict[str, Any] = {"t": "f", "ts": round(ts, 2), "dt": dt, "o": records}
        # The nominal poll interval is in the header; these carry the ACTUAL
        # values, and only when they moved.  Both Kalman Q and the silence
        # grace window are derived from the poll interval, so a mid-session
        # settings change that went unrecorded would diverge a replay silently.
        if round(float(poll_s), 3) != self._poll_s:
            self._poll_s = round(float(poll_s), 3)
            frame["pi"] = self._poll_s
        if int(vote_window) != self._vw or int(vote_threshold) != self._vt:
            self._vw, self._vt = int(vote_window), int(vote_threshold)
            frame["vw"], frame["vt"] = self._vw, self._vt
        if dropped:
            # A truncated frame announces itself or a fixture silently claims
            # to be a complete picture of a site it only sampled.
            frame["tr"] = dropped
            self._session["truncated"] += dropped

        self._append(frame)
        self._session["frames"] += 1
        self._session["objects"] = max(self._session["objects"], len(records))

        if ts >= self._ends_ts:
            self._stop_reason = "duration"
        elif self._session["bytes"] >= MAX_SESSION_BYTES:
            self._stop_reason = "size_cap"
        return True

    def mark_ground_truth(self, room: str, keys: list[str] | None = None,
                          now: float | None = None) -> bool:
        """Record the operator's assertion of where a device actually is.

        With explicit keys, those are labelled.  Without, the session's own key
        filter is used; without that either, EVERY captured object is labelled
        — a single-occupant walkthrough is what people record, and a mark that
        silently labelled nothing would be the worst of the three answers.
        """
        if self._session is None:
            return False
        ts = float(now if now is not None else time.time())
        if keys:
            self._gt_keys = {str(k) for k in keys}
        else:
            self._gt_keys = set(self._session_keys) if self._session_keys else None
        self._gt_room = str(room or "")
        self._append({"t": "gt", "ts": round(ts, 2), "room": self._gt_room,
                      "keys": sorted(self._gt_keys) if self._gt_keys else []})
        return True

    # ── frame construction ────────────────────────────────────────────────────

    def _object_record(
        self,
        key: str,
        obj: dict[str, Any],
        addr_src_rssi: dict[str, dict[str, float]],
        rpa_map: dict[str, str],
        pinned: dict[str, dict[str, Any]],
        coord: Any,
    ) -> dict[str, Any] | None:
        kind = str(obj.get("kind") or "")
        if kind not in ("ble", "private_ble", "ibeacon"):
            return None   # entity trackers arrive pre-smoothed; there is no vector to replay
        if self._session_keys is not None:
            # An explicit key list means the operator is diagnosing something
            # specific, and it overrides everything below — including a device
            # the system has never identified, which is often the whole point.
            if key not in self._session_keys:
                return None
        elif not self._worth_recording(key, obj):
            return None

        if kind == "ibeacon":
            # The merged vector is built inside the object loop and does not
            # survive to the hook, so it is rebuilt here from the same inputs.
            # addr_src_rssi is frozen well before this point, so the rebuild is
            # exact.  It must NOT be taken from obj["_source_rssi"] — that is
            # the Kalman-SMOOTHED vector, and a fixture built from the filter's
            # own output can never reproduce the filter.
            addr = key
            vec: dict[str, float] = {}
            for a in (obj.get("all_addresses") or []):
                for src, rssi in (addr_src_rssi.get(str(a).upper()) or {}).items():
                    if src not in vec or rssi > vec[src]:
                        vec[src] = rssi
        else:
            raw = str(obj.get("address") or "").upper()
            addr = rpa_map.get(raw, raw)
            vec = dict(addr_src_rssi.get(addr) or {})

        rec: dict[str, Any] = {"k": key, "a": addr, "t": kind}
        rec["v"] = self._index_vector(vec)

        tx = obj.get("tx_power")
        if tx is not None:
            rec["x"] = int(tx)
        # ESPresense nodes publish a node-calibrated distance the spatial path
        # uses directly instead of re-deriving it; without this an ESPresense
        # install replays through a different distance model than it ran on.
        es = (getattr(coord, "_espresense_dist", None) or {}).get(addr)
        if es:
            rec["e"] = self._index_vector(es, nd=2)

        if key not in self._warmed:
            self._warmed.add(key)
            rec["w"] = self._warm_state(key, addr, coord)

        # Outputs — what makes it a golden fixture rather than a log.
        room = obj.get("room")
        if room:
            rec["r"] = str(room)
        conf = obj.get("room_confidence")
        if conf is not None:
            rec["c"] = _round(conf, 2)
        if obj.get("x_m") is not None and obj.get("y_m") is not None:
            rec["mx"] = _round(obj["x_m"], 3)
            rec["my"] = _round(obj["y_m"], 3)
            rec["mf"] = str(obj.get("floor_id") or "")
        if obj.get("knn_confidence") is not None:
            rec["q"] = _round(obj["knn_confidence"], 2)
        if key in pinned:
            # The pin overrides the pipeline AFTER _smooth_room returns, so `r`
            # here is the pin, not the pipeline's answer.  A replay that scores
            # a pinned beacon against `r` fails every assertion for a reason
            # nobody would find; `p` is how it tells them apart.
            rec["p"] = str((pinned[key] or {}).get("room") or "")
        if self._gt_room and (self._gt_keys is None or key in self._gt_keys):
            rec["g"] = self._gt_room

        label = obj.get("user_label") or obj.get("name")
        if label and str(label) != key:
            # Carried out to the manifest, not repeated 2000 times in the file.
            rec["_n"] = str(label)[:30]
        return rec

    def _worth_recording(self, key: str, obj: dict[str, Any]) -> bool:
        """Identified or followed only — the same rule the traceback uses.

        This house shows about 1,800 BLE objects per poll. Nearly all of them
        are neighbours' phones and passing cars heard by one or two scanners:
        useless to a positioning fixture, which needs a device that is present
        long enough and heard widely enough to be positioned at all, and not
        ours to record either. Keeping the lot meant a 250-of-1,800 sample that
        called itself a recording.

        Filtering here rather than at the truncation cap is the difference
        between a faithful record of the devices that matter and a large
        arbitrary slice of everything. It also means MAX_OBJECTS_PER_FRAME
        stops being load-bearing on a normal install and goes back to being
        what it was meant to be — a backstop.
        """
        if obj.get("identified") or obj.get("user_label"):
            return True
        for field in ("key", "address", "entity_id"):
            if str(obj.get(field) or "") in self._followed:
                return True
        return key in self._followed

    def _warm_state(self, key: str, addr: str, coord: Any) -> dict[str, Any]:
        """Filter state AFTER this frame's update — what the NEXT frame consumes.

        A session starts with the coordinator warm.  Replaying from a cold
        filter diverges for the first several frames and every assertion in
        that window is noise, which is exactly why the existing traceback
        could not serve as a replay source.
        """
        ema = (getattr(coord, "_ema_rssi", None) or {}).get(addr) or {}
        kp = (getattr(coord, "_kalman_p", None) or {}).get(addr) or {}
        miss = (getattr(coord, "_silence_miss", None) or {}).get(addr) or {}
        votes = (getattr(coord, "_room_votes", None) or {}).get(key)
        w: dict[str, Any] = {
            "ema": self._index_vector(ema, nd=2),
            "p": self._index_vector(kp, nd=3),
            "m": self._index_vector(miss, nd=0),
            "vt": [str(v) for v in (votes or ())],
            "r": (getattr(coord, "_confirmed_room", None) or {}).get(key) or "",
        }
        for attr, field in (("_smooth_xy", "sxy"), ("_spatial_smooth_xy", "pxy")):
            xy = (getattr(coord, attr, None) or {}).get(key)
            if isinstance(xy, (list, tuple)) and len(xy) >= 2:
                w[field] = [_round(xy[0], 3), _round(xy[1], 3)]
        return w

    def _index_vector(self, vec: dict[str, Any], nd: int = 1) -> dict[str, Any]:
        """{scanner: value} -> {source_index: value}, strongest kept.

        A literal MAC key costs 26 bytes per source per object per frame; an
        index key costs 10.  On a 21-scanner site that is the difference
        between a 5 MB session and a 2.5 MB one, and at commercial scale it is
        what makes the byte cap reachable at all.
        """
        if not vec:
            return {}
        items = sorted(vec.items(), key=lambda kv: _sort_value(kv[1]), reverse=True)
        out: dict[str, Any] = {}
        for src, val in items[:MAX_SOURCES_PER_OBJECT]:
            idx = self._src_index.get(str(src))
            if idx is None:
                # A radio that appeared mid-session.  Appending keeps every
                # index already written valid; the env line announces it.
                idx = len(self._src_list)
                self._src_list.append(str(src))
                self._src_index[str(src)] = idx
            out[str(idx)] = int(val) if nd == 0 else _round(val, nd)
        return out

    def _emit_env(self, source_to_area: dict[str, str], source_to_floor: dict[str, str],
                  addr_src_rssi: dict[str, dict[str, float]], ts: float) -> None:
        """Announce mid-session changes to the source set or its attribution."""
        before = len(self._src_list)
        for per_src in addr_src_rssi.values():
            for src in per_src:
                if str(src) not in self._src_index:
                    self._src_index[str(src)] = len(self._src_list)
                    self._src_list.append(str(src))
        env: dict[str, Any] = {}
        if len(self._src_list) != before:
            env["src"] = list(self._src_list)
        if source_to_area != self._s2a:
            self._s2a = dict(source_to_area)
            env["s2a"] = dict(self._s2a)
        if source_to_floor != self._s2f:
            self._s2f = dict(source_to_floor)
            env["s2f"] = dict(self._s2f)
        if env:
            env["t"] = "env"
            env["ts"] = round(ts, 2)
            self._append(env)

    def _append(self, record: dict[str, Any]) -> None:
        """Serialize now, so the byte caps are exact rather than estimated."""
        try:
            line = json.dumps(record, separators=(",", ":"), default=str)
        except (TypeError, ValueError) as err:
            _LOGGER.debug("Capture record not serializable: %s", err)
            return
        self._pending.append(line)
        self._pending_bytes += len(line) + 1
        if self._session is not None:
            self._session["bytes"] += len(line) + 1

    # ── disk ──────────────────────────────────────────────────────────────────

    async def async_maybe_flush(self, now: float | None = None) -> bool:
        ts = float(now if now is not None else time.time())
        due = (ts - self._last_flush_ts >= FLUSH_INTERVAL_S
               or self._pending_bytes >= MAX_PENDING_BYTES)
        if due and self._pending:
            await self.async_flush(now=ts)
        # An auto-stop is raised in record_frame (sync) and honoured here, so
        # the session's own end line lands in the same flush as its last frame.
        if self._stop_reason:
            await self.async_stop(self._stop_reason, now=ts)
            return True
        return due

    async def async_flush(self, now: float | None = None) -> None:
        pending, self._pending = self._pending, []
        self._pending_bytes = 0
        self._last_flush_ts = float(now if now is not None else time.time())
        if not pending or self._session is None:
            return
        await self.hass.async_add_executor_job(
            self._append_lines_sync, self._path(self._session["id"]), pending)

    def _path(self, session_id: str) -> Path:
        return self._seg_dir / f"{session_id}.jsonl"

    def _append_lines_sync(self, path: Path, lines: list[str]) -> None:
        self._seg_dir.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            for line in lines:
                fh.write(line + "\n")

    def _stat_sync(self, path: Path) -> int:
        try:
            return int(path.stat().st_size)
        except OSError:
            return 0

    def _read_lines_sync(self, path: Path, offset: int, limit: int) -> dict[str, Any]:
        lines: list[str] = []
        total = 0
        size = 0
        truncated = False
        try:
            with open(path, encoding="utf-8") as fh:
                for i, line in enumerate(fh):
                    total = i + 1
                    if i < offset or truncated:
                        continue
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    try:
                        json.loads(line)
                    except ValueError:
                        continue  # torn line from a crash mid-append
                    if len(lines) >= limit or size + len(line) > MAX_PAGE_BYTES:
                        truncated = True
                        continue
                    lines.append(line)
                    size += len(line)
        except OSError:
            return {"lines": [], "offset": offset, "total": 0, "eof": True}
        return {"lines": lines, "offset": offset, "total": total,
                "eof": offset + len(lines) >= total}

    def _delete_files_sync(self, session_ids: list[str]) -> int:
        removed = 0
        for sid in session_ids:
            try:
                self._path(sid).unlink()
                removed += 1
            except OSError:
                pass
        return removed

    async def async_read_lines(self, session_id: str, offset: int = 0,
                               limit: int = 2000) -> dict[str, Any] | None:
        if not self._meta(session_id):
            return None
        page = await self.hass.async_add_executor_job(
            self._read_lines_sync, self._path(session_id), int(offset), int(limit))
        page["meta"] = self._meta(session_id)
        return page

    async def async_delete(self, session_id: str) -> bool:
        meta = self._meta(session_id)
        if not meta or (self._session or {}).get("id") == session_id:
            return False
        self.data["sessions"] = [s for s in self.data["sessions"] if s.get("id") != session_id]
        await self.hass.async_add_executor_job(self._delete_files_sync, [session_id])
        await self.store.async_save(self.data)
        return True

    async def async_clear(self) -> int:
        """Drop every session, files included.  Used by factory reset.

        This store's payload is not in the backup blob, so a factory reset that
        cleared only the manifest would leave 200 MB of .jsonl behind.
        """
        ids = [str(s.get("id")) for s in self.data.get("sessions") or []]
        if self._session is not None:
            await self.async_stop("cleared")
            ids = [str(s.get("id")) for s in self.data.get("sessions") or []]
        self.data = {"sessions": []}
        await self.hass.async_add_executor_job(self._delete_files_sync, ids)
        await self.store.async_save(self.data)
        return len(ids)

    # ── query ─────────────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        sess = self._session
        if sess is None:
            return {"recording": False, "session_id": "", "frames": 0, "objects": 0,
                    "bytes": 0, "sources": len(self._src_list), "gt_room": "",
                    "truncated": 0, "started_ts": 0, "ends_ts": 0}
        return {"recording": True, "session_id": sess["id"], "frames": sess["frames"],
                "objects": sess["objects"], "bytes": sess["bytes"],
                "sources": len(self._src_list), "gt_room": self._gt_room,
                "truncated": sess["truncated"], "started_ts": sess["t0"],
                "ends_ts": round(self._ends_ts, 2)}

    def list_sessions(self) -> list[dict[str, Any]]:
        self._prune()
        return sorted((dict(s) for s in self.data.get("sessions") or []),
                      key=lambda s: s.get("t0") or 0, reverse=True)

    def _meta(self, session_id: str) -> dict[str, Any] | None:
        """Metadata for a session, running or finished.

        The active session counts. It is the one the operator is looking at
        when they open the tab, and a status that says "recording" beside an
        export that says "no such session" is not a defensible pair.
        """
        if (self._session or {}).get("id") == session_id:
            return dict(self._session or {})
        for s in self.data.get("sessions") or []:
            if s.get("id") == session_id:
                return dict(s)
        return None

    def _orphans(self) -> list[str]:
        """Session ids whose manifest row is gone — their files must go too."""
        known = {str(s.get("id")) for s in self.data.get("sessions") or []}
        if self._session is not None:
            known.add(str(self._session["id"]))
        try:
            return [p.stem for p in self._seg_dir.glob("*.jsonl") if p.stem not in known]
        except OSError:
            return []

    def retention_days(self) -> int:
        try:
            from .const import DATA_SETTINGS, DOMAIN
            st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            days = int((getattr(st, "data", None) or {}).get(
                "rssi_capture_retention_days", DEFAULT_RETENTION_DAYS))
        except Exception:
            return DEFAULT_RETENTION_DAYS
        return days if days in RETENTION_CHOICES else DEFAULT_RETENTION_DAYS

    def _prune(self) -> None:
        """Age, then count, then bytes — the house order.

        The active session is never a candidate.  Evicted rows lose their files
        on the next executor pass (async_stop / async_delete); this store owns
        files, so a manifest-only prune would leak disk.
        """
        sessions = sorted((s for s in self.data.get("sessions") or [] if isinstance(s, dict)),
                          key=lambda s: s.get("t0") or 0)
        cutoff = time.time() - self.retention_days() * 86400
        keep = [s for s in sessions if float(s.get("t0") or 0) >= cutoff]
        if len(keep) > MAX_SESSIONS:
            keep = keep[-MAX_SESSIONS:]
        running = 0
        bounded: list[dict[str, Any]] = []
        for s in reversed(keep):          # newest first
            running += int(s.get("bytes") or 0)
            if running > MAX_TOTAL_BYTES and bounded:
                break
            bounded.append(s)
        self.data["sessions"] = list(reversed(bounded))


def _sort_value(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("-inf")


def _object_rank(rec: dict[str, Any]) -> tuple[int, int, int]:
    """Truncation ranking: ground truth, then pinned, then scanner coverage.

    An object heard by fourteen scanners is worth more to a positioning fixture
    than one heard by two, and a labelled object is the only thing in the frame
    that can be scored at all.
    """
    return (1 if rec.get("g") else 0, 1 if rec.get("p") else 0, len(rec.get("v") or {}))
