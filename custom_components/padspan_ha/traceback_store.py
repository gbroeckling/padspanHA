# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent traceback store — 7 days of object position snapshots.

Every ~10 s the coordinator records a compact position record for each
tracked object (identified or followed).  The store keeps 7 days.

The daily JSONL segment files ARE the history
(.storage/padspan_ha.traceback_segments/YYYYMMDD.jsonl, one frame per line,
appended every 30 s).  Memory holds only the last few minutes: a full week
read back into Python objects was about 1 KB per tracked object per frame —
some 600 MB for ten devices at home — and since 0.38.112 records with no
panel open, every install filled it.  A replay, Insights and the object list
read the files on demand, in the executor, streaming: a replay counts the
window's frames, then parses only the ones it keeps.

Segment line format (one frame per line, "ts" first):
  {"ts": ..., "o": [{k, r, x_m, y_m, f, c, rssi, n, t, src, pid}]}
"""

import asyncio
import calendar
import json
import logging
import os
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Iterator

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "padspan_ha.traceback"
SEGMENT_DIR = "padspan_ha.traceback_segments"
MAX_FRAMES = 60480          # 7 days at ~10 s interval (what a week holds)
MAX_AGE_S = 86400 * 7       # 7 days
SAVE_INTERVAL_S = 30         # flush to disk every 30 s
MIN_FRAME_INTERVAL_S = 8     # min gap between recorded frames
MEM_WINDOW_S = 600           # recent frames kept in memory (diagnostics)
BACKUP_WINDOW_S = 86400      # a backup carries the last day, not the week
_TS_PREFIX = '{"ts":'


def _line_ts(line: str) -> float | None:
    """A segment line's timestamp without parsing the whole frame."""
    if line.startswith(_TS_PREFIX):
        end = line.find(",", len(_TS_PREFIX))
        if end > 0:
            try:
                return float(line[len(_TS_PREFIX):end])
            except ValueError:
                pass
    try:
        f = json.loads(line)
    except ValueError:
        return None
    if isinstance(f, dict) and f.get("ts"):
        try:
            return float(f["ts"])
        except (TypeError, ValueError):
            return None
    return None


def _dump(frame: dict[str, Any]) -> str:
    # "ts" first, so _line_ts can read it from the line's start.
    out = {"ts": frame.get("ts"), **{k: v for k, v in frame.items() if k != "ts"}}
    return json.dumps(out, separators=(",", ":"))


class TracebackStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, 1, STORE_KEY)  # legacy blob, migrated away on load
        self.frames: list[dict[str, Any]] = []     # the last MEM_WINDOW_S only
        self._pending: list[dict[str, Any]] = []   # recorded but not yet on disk
        self._last_save_ts: float = 0
        self._last_frame_ts: float = 0
        self._seg_dir = Path(hass.config.path(".storage", SEGMENT_DIR))
        # Held around every file read and write: a replay counting a window
        # while a flush appends to it would count frames twice.
        self._io_lock = asyncio.Lock()
        # Object list and frame counts, built from the files on first use
        # and kept up to date after (None = not built yet).
        self._keys: OrderedDict[str, dict[str, Any]] | None = None
        self._file_counts: dict[str, int] = {}
        self._file_first: dict[str, float] = {}

    # ── files ────────────────────────────────────────────────────────────

    @staticmethod
    def _seg_name(ts: float) -> str:
        return time.strftime("%Y%m%d", time.gmtime(ts)) + ".jsonl"

    @staticmethod
    def _seg_day_start(path: Path) -> float | None:
        """UTC timestamp of the segment file's day, or None if not a segment name."""
        try:
            return calendar.timegm(time.strptime(path.stem, "%Y%m%d"))
        except ValueError:
            return None

    def _files(self, start_ts: float = 0.0, end_ts: float = float("inf")) -> list[Path]:
        """Segment files whose UTC day overlaps [start_ts, end_ts], oldest first."""
        if not self._seg_dir.is_dir():
            return []
        out = []
        for p in sorted(self._seg_dir.glob("*.jsonl")):
            day = self._seg_day_start(p)
            if day is None or day + 86400 < start_ts or day > end_ts:
                continue
            out.append(p)
        return out

    def _iter_lines_sync(self, start_ts: float, end_ts: float,
                         clamp: bool = True) -> Iterator[tuple[float, str]]:
        # A caller that reads twice clamps once and passes clamp=False
        # (_get_frames_sync), or each pass took its own "now".
        if clamp:
            start_ts = max(start_ts, time.time() - MAX_AGE_S)
        for p in self._files(start_ts, end_ts):
            try:
                with open(p, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        ts = _line_ts(line)
                        if ts is None or ts < start_ts or ts > end_ts:
                            continue
                        yield ts, line
            except OSError:
                continue

    def _iter_frames_sync(self, start_ts: float, end_ts: float,
                          extra: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        """Every frame in the window, oldest first: the files, then the
        recorded frames not yet written."""
        for _ts, line in self._iter_lines_sync(start_ts, end_ts):
            try:
                f = json.loads(line)
            except ValueError:
                continue  # torn line from a crash mid-append
            if isinstance(f, dict):
                yield f
        for f in extra:
            if start_ts <= f.get("ts", 0) <= end_ts:
                yield f

    def _read_segments_sync(self) -> list[dict[str, Any]]:
        """The whole week as frames, for tests; everything else streams."""
        return list(self._iter_frames_sync(0.0, float("inf"), []))

    def _append_sync(self, pending: list[dict[str, Any]]) -> None:
        self._seg_dir.mkdir(parents=True, exist_ok=True)
        by_file: dict[str, list[dict[str, Any]]] = {}
        for f in pending:
            by_file.setdefault(self._seg_name(f.get("ts") or time.time()), []).append(f)
        for name, fs in by_file.items():
            with open(self._seg_dir / name, "a", encoding="utf-8") as fh:
                for f in fs:
                    fh.write(_dump(f) + "\n")
            self._file_counts[name] = self._file_counts.get(name, 0) + len(fs)
            self._file_first.setdefault(name, fs[0].get("ts") or 0.0)

    def _write_files_sync(self, frames: list[dict[str, Any]]) -> None:
        """Rewrite the day files these frames fall on, merged with what each
        already holds (by timestamp), in time order."""
        self._seg_dir.mkdir(parents=True, exist_ok=True)
        by_file: dict[str, dict[float, str]] = {}
        for f in frames:
            ts = f.get("ts")
            if ts:
                by_file.setdefault(self._seg_name(ts), {})[float(ts)] = _dump(f)
        for name, incoming in by_file.items():
            path = self._seg_dir / name
            merged: dict[float, str] = {}
            if path.exists():
                with open(path, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        ts = _line_ts(line) if line else None
                        if ts is not None:
                            merged[ts] = line
            for ts, line in incoming.items():
                merged.setdefault(ts, line)
            tmp = path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                for ts in sorted(merged):
                    fh.write(merged[ts] + "\n")
            os.replace(tmp, path)

    def _delete_all_sync(self) -> None:
        if self._seg_dir.is_dir():
            for p in self._seg_dir.glob("*.jsonl"):
                try:
                    p.unlink()
                except OSError:
                    pass

    def _prune_segment_files_sync(self) -> None:
        if not self._seg_dir.is_dir():
            return
        cutoff = time.time() - MAX_AGE_S
        for p in self._seg_dir.glob("*.jsonl"):
            day = self._seg_day_start(p)
            if day is not None and day + 86400 < cutoff:
                try:
                    p.unlink()
                except OSError:
                    continue
                self._file_counts.pop(p.name, None)
                self._file_first.pop(p.name, None)

    def _build_index_sync(self) -> None:
        """The object list and per-file counts, from one pass over the files."""
        keys: OrderedDict[str, dict[str, Any]] = OrderedDict()
        counts: dict[str, int] = {}
        first: dict[str, float] = {}
        for p in self._files(time.time() - MAX_AGE_S):
            n = 0
            try:
                with open(p, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            f = json.loads(line)
                        except ValueError:
                            continue
                        if not isinstance(f, dict) or not f.get("ts"):
                            continue
                        n += 1
                        first.setdefault(p.name, float(f["ts"]))
                        self._index_frame(keys, f)
            except OSError:
                continue
            counts[p.name] = n
        self._keys, self._file_counts, self._file_first = keys, counts, first

    @staticmethod
    def _index_frame(keys: OrderedDict[str, dict[str, Any]], f: dict[str, Any]) -> None:
        for o in f.get("o", []):
            k = o.get("k", "")
            if not k:
                continue
            keys[k] = {"key": k, "name": o.get("n", k), "kind": o.get("t", ""), "ts": f.get("ts", 0)}
            keys.move_to_end(k)

    # ── lifecycle ────────────────────────────────────────────────────────

    async def async_load(self) -> None:
        legacy = await self._store.async_load()
        legacy_frames = (legacy.get("frames") or []) if isinstance(legacy, dict) else []
        if legacy_frames:
            # One-time migration from the pre-segment single file, merged
            # with any segments by timestamp (overlap only if a past
            # migration was interrupted between segment write and removal).
            async with self._io_lock:
                await self.hass.async_add_executor_job(
                    self._write_files_sync,
                    [f for f in legacy_frames if isinstance(f, dict) and f.get("ts")])
            try:
                await self._store.async_remove()
            except Exception as err:
                _LOGGER.debug("Legacy traceback store removal failed: %s", err)
            _LOGGER.info("TracebackStore migrated %d frames to append-only segments", len(legacy_frames))
        now = time.time()
        async with self._io_lock:
            self.frames = await self.hass.async_add_executor_job(
                lambda: list(self._iter_frames_sync(now - MEM_WINDOW_S, now, [])))
        self._last_save_ts = time.time()
        _LOGGER.debug("TracebackStore loaded: %d recent frames in memory", len(self.frames))

    def record_frame(self, objects: list[dict[str, Any]], followed_set: set[str] | None = None) -> None:
        """Record a position snapshot for identified/followed objects only.

        Called from the snapshot builder (~every 10 s).  Only records
        objects that are identified (labelled/known) or followed — matching
        what overview actually displays.  Raw unidentified BLE noise is excluded.
        """
        now = time.time()
        if now - self._last_frame_ts < MIN_FRAME_INTERVAL_S:
            return
        self._last_frame_ts = now

        _fset = followed_set or set()

        compact: list[dict[str, Any]] = []
        for o in objects:
            room = o.get("room")
            if not room or room in ("unknown", "not_home"):
                continue
            key = o.get("key") or o.get("address") or o.get("entity_id") or ""
            if not key:
                continue
            # A pinned beacon is a fixed reference, not something that moves:
            # recorded, it sat in its room every frame and counted towards
            # every hour's occupancy in Insights and Busy Times.
            if o.get("_pinned"):
                continue
            # Only record identified or followed objects (skip anonymous BLE noise)
            is_identified = o.get("identified") or o.get("user_label")
            is_followed = (str(key).upper() in _fset or str(o.get("address") or "").upper() in _fset
                           or str(o.get("entity_id") or "").upper() in _fset)
            if not is_identified and not is_followed:
                continue
            entry: dict[str, Any] = {
                "k": key,
                "r": room,
            }
            # Stable identity: include padspan_id if available
            pid = o.get("padspan_id")
            if pid:
                entry["pid"] = pid
            # Sub-room position, in metres. History used to be recorded in
            # whichever photo's fraction space the k-NN happened to answer in,
            # so replaying it meant resolving a map id and its transform —
            # and re-placing that photo silently moved the past. Metres are
            # the same yesterday as today.
            x_m = o.get("x_m")
            y_m = o.get("y_m")
            if x_m is not None and y_m is not None:
                entry["x_m"] = round(float(x_m), 3)
                entry["y_m"] = round(float(y_m), 3)
                fl = o.get("floor_id")
                if fl:
                    entry["f"] = str(fl)
            # Room confidence
            conf = o.get("room_confidence")
            if conf is not None:
                entry["c"] = round(float(conf), 2)
            # Optional enrichment (compact)
            rssi = o.get("rssi")
            if rssi is not None:
                entry["rssi"] = rssi
            label = o.get("user_label") or o.get("name")
            if label and label != key:
                entry["n"] = label[:30]
            kind = o.get("kind")
            if kind:
                entry["t"] = kind  # type/kind
            # Best source scanner
            sources = o.get("sources") or []
            if sources:
                src = sources[0] if isinstance(sources[0], str) else (sources[0].get("source") if isinstance(sources[0], dict) else "")
                if src:
                    entry["src"] = src
            compact.append(entry)

        if not compact:
            return

        frame = {
            "ts": now,
            "o": compact,
        }
        self.frames.append(frame)
        self._pending.append(frame)
        if self._keys is not None:
            self._index_frame(self._keys, frame)
        self._prune()

    async def async_maybe_save(self) -> None:
        """Flush new frames to disk if enough time has elapsed. Not while a
        replay, Insights or the object list is reading the files: the poll
        waited behind them (seconds on a Pi), delaying arrive/depart rules.
        Readers include the pending frames, so the next poll flushes."""
        if time.time() - self._last_save_ts < SAVE_INTERVAL_S or self._io_lock.locked():
            return
        await self.async_flush()

    async def async_flush(self) -> None:
        """Append pending frames to their daily segments and prune old files.

        Only the frames recorded since the last flush are written — the
        existing on-disk history is never rewritten.
        """
        self._prune()
        async with self._io_lock:
            pending, self._pending = self._pending, []
            if pending:
                await self.hass.async_add_executor_job(self._append_sync, pending)
            await self.hass.async_add_executor_job(self._prune_segment_files_sync)
        self._last_save_ts = time.time()

    async def async_replace(self, frames: Any) -> None:
        """Replace the whole history with these frames — a factory reset
        ([]). The daily segment files ARE the store: a reset that emptied
        only the old single file left every segment."""
        kept = self._valid(frames)
        async with self._io_lock:
            self._pending = []
            await self.hass.async_add_executor_job(self._delete_all_sync)
            if kept:
                await self.hass.async_add_executor_job(self._write_files_sync, kept)
            self._reset_index()
        self._reload_memory(kept, replace=True)

    async def async_merge(self, frames: Any) -> None:
        """A restore: the backup's frames join the history by timestamp.
        Replacing it erased every movement recorded since the backup."""
        kept = self._valid(frames)
        async with self._io_lock:
            pending, self._pending = self._pending, []
            if pending:
                await self.hass.async_add_executor_job(self._append_sync, pending)
            if kept:
                await self.hass.async_add_executor_job(self._write_files_sync, kept)
            await self.hass.async_add_executor_job(self._prune_segment_files_sync)
            self._reset_index()
        self._reload_memory(kept, replace=False)

    async def async_export(self, window_s: float = BACKUP_WINDOW_S) -> list[dict[str, Any]]:
        """The frames a backup carries: the last day. A week was ~120 MB in
        every backup, and the backups file is read whole for every list."""
        now = time.time()
        async with self._io_lock:
            extra = list(self._pending)
            return await self.hass.async_add_executor_job(
                lambda: list(self._iter_frames_sync(now - window_s, now, extra)))

    @staticmethod
    def _valid(frames: Any) -> list[dict[str, Any]]:
        if isinstance(frames, dict):
            frames = frames.get("frames")
        cutoff = time.time() - MAX_AGE_S
        return sorted((f for f in (frames or []) if isinstance(f, dict) and f.get("ts")
                       and f["ts"] > cutoff), key=lambda f: f["ts"])

    def _reset_index(self) -> None:
        self._keys = None
        self._file_counts, self._file_first = {}, {}

    def _reload_memory(self, frames: list[dict[str, Any]], replace: bool) -> None:
        cutoff = time.time() - MEM_WINDOW_S
        recent = [f for f in frames if f["ts"] > cutoff]
        if replace:
            self.frames = recent
        else:
            by_ts = {f["ts"]: f for f in self.frames + recent}
            self.frames = [by_ts[t] for t in sorted(by_ts)]

    # ── reads ────────────────────────────────────────────────────────────

    async def async_get_frames(
        self,
        start_ts: float | None = None,
        end_ts: float | None = None,
        obj_key: str | None = None,
        max_frames: int = 4000,
        with_count: bool = False,
    ) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], int]:
        """Frames within the time window, optionally filtered to one object,
        evenly thinned to max_frames. with_count: also the number of frames
        the window held before thinning — how a replay tells a thinned list
        from a real absence."""
        now = time.time()
        start = now - 300 if start_ts is None else float(start_ts)
        end = now if end_ts is None else float(end_ts)
        async with self._io_lock:
            extra = list(self._pending)
            frames, n = await self.hass.async_add_executor_job(
                self._get_frames_sync, start, end, obj_key, max_frames, extra)
        return (frames, n) if with_count else frames

    def _get_frames_sync(self, start: float, end: float, obj_key: str | None,
                         max_frames: int, extra: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
        needle = ('"k":' + json.dumps(obj_key, separators=(",", ":"))) if obj_key else None

        def _one(f: dict[str, Any]) -> dict[str, Any] | None:
            if not obj_key:
                return f
            objs = [o for o in f.get("o", []) if o.get("k") == obj_key]
            return {"ts": f.get("ts"), "o": objs} if objs else None

        # One retention floor for both passes: a frame crossing the cutoff
        # between them shifted every kept index by one, and a thinned 7-day
        # replay lost its newest frames.
        start = max(start, time.time() - MAX_AGE_S)
        extra = [f for f in extra if start <= f.get("ts", 0) <= end and _one(f) is not None]
        # Pass 1 counts; pass 2 parses only the frames kept. Downsampled
        # evenly, never cut short, so a replay spans the whole window (a
        # 7-day range once replayed only its oldest ~9 hours).
        n = sum(1 for _ts, line in self._iter_lines_sync(start, end, clamp=False)
                if needle is None or needle in line) + len(extra)
        if n > max_frames:
            wanted = ({round(i * (n - 1) / (max_frames - 1)) for i in range(max_frames)}
                      if max_frames > 1 else {n - 1})
        else:
            wanted = None
        out: list[dict[str, Any]] = []
        i = 0
        for _ts, line in self._iter_lines_sync(start, end, clamp=False):
            if needle is not None and needle not in line:
                continue
            if wanted is None or i in wanted:
                try:
                    f = json.loads(line)
                except ValueError:
                    f = None
                one = _one(f) if isinstance(f, dict) else None
                if one is not None:
                    out.append(one)
            i += 1
        for f in extra:
            if wanted is None or i in wanted:
                out.append(_one(f))
            i += 1
        return out, n

    async def async_dwell(self, start_ts: float, end_ts: float, tz_name: str) -> dict[str, Any]:
        """Insights' time-in-room, streamed over the files in the executor
        (it ran on HA's event loop over the whole in-memory week)."""
        from .dwell_analytics import compute_dwell_stats  # noqa: PLC0415
        async with self._io_lock:
            extra = list(self._pending)
            return await self.hass.async_add_executor_job(
                lambda: compute_dwell_stats(self._iter_frames_sync(start_ts, end_ts, extra),
                                            tz_name=tz_name, presorted=True))

    async def _async_index(self) -> OrderedDict[str, dict[str, Any]]:
        async with self._io_lock:
            if self._keys is None:
                await self.hass.async_add_executor_job(self._build_index_sync)
                for f in self._pending:
                    self._index_frame(self._keys, f)
            return self._keys

    async def async_get_object_keys(self) -> list[dict[str, str]]:
        """Every object in the week's history with its latest label/kind,
        most recently seen first."""
        keys = await self._async_index()
        cutoff = time.time() - MAX_AGE_S
        out = []
        for k in reversed(keys):
            v = keys[k]
            if v.get("ts", 0) <= cutoff:
                continue
            out.append({"key": v["key"], "name": v["name"], "kind": v["kind"]})
            if len(out) > 500:
                break
        return out

    async def async_get_time_range(self) -> dict[str, float]:
        """The earliest and latest timestamp held, and how many frames."""
        await self._async_index()
        cutoff = time.time() - MAX_AGE_S
        firsts = [t for t in self._file_first.values() if t]
        count = sum(self._file_counts.values()) + len(self._pending)
        if not count:
            return {"start": 0, "end": 0, "count": 0}
        if firsts:
            start = max(min(firsts), cutoff)
        else:
            start = self._pending[0].get("ts", 0) if self._pending else 0
        # The newest frame anyone is in: memory holds only ten minutes, and
        # with nobody home in them the end fell back to the start, so a
        # filtered replay's auto-expand searched an empty range.
        end = max((v.get("ts", 0) for v in self._keys.values()), default=start)
        return {"start": start, "end": end, "count": count}

    def _prune(self) -> None:
        cutoff = time.time() - MEM_WINDOW_S
        if self.frames and self.frames[0].get("ts", 0) <= cutoff:
            self.frames = [f for f in self.frames if f.get("ts", 0) > cutoff]
