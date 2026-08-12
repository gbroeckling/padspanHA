# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Persistent traceback store — rolling ring buffer of object position snapshots.

Every ~10 s the snapshot builder appends a compact position record for each
tracked object (identified or followed).  The store keeps up to 7 days and
60 480 frames (~10 s interval × 7 days).  Older frames are pruned on save.

Persistence is APPEND-ONLY: frames are appended to daily JSONL segment files
(.storage/padspan_ha.traceback_segments/YYYYMMDD.jsonl).  Each 30 s flush
writes only the frames recorded since the last flush (a few hundred bytes)
instead of rewriting the whole multi-MB buffer — the old full-rewrite scheme
was ~2 880 full writes/day of severe SD-card wear.  Old segments are pruned
by deleting whole files; the legacy single-blob Store is imported once on
first load and then removed.

Segment line format (one frame per line):
  {"ts": ..., "o": [{k, r, rssi, src}]}

Each frame is ~10 s of wall-clock time.  The frontend fetches a time-window
and animates objects on the 3D map.
"""

import calendar
import json
import logging
import time
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "padspan_ha.traceback"
SEGMENT_DIR = "padspan_ha.traceback_segments"
MAX_FRAMES = 60480          # 7 days at ~10 s interval
MAX_AGE_S = 86400 * 7       # 7 days
SAVE_INTERVAL_S = 30         # flush to disk every 30 s
MIN_FRAME_INTERVAL_S = 8     # min gap between recorded frames


class TracebackStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, 1, STORE_KEY)  # legacy blob, migrated away on load
        self.frames: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []   # recorded but not yet on disk
        self._last_save_ts: float = 0
        self._last_frame_ts: float = 0
        self._seg_dir = Path(hass.config.path(".storage", SEGMENT_DIR))

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

    def _read_segments_sync(self) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        if not self._seg_dir.is_dir():
            return frames
        cutoff = time.time() - MAX_AGE_S
        for p in sorted(self._seg_dir.glob("*.jsonl")):
            day = self._seg_day_start(p)
            if day is None or day + 86400 < cutoff:
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            f = json.loads(line)
                        except ValueError:
                            continue  # torn line from a crash mid-append
                        if isinstance(f, dict) and f.get("ts"):
                            frames.append(f)
            except OSError:
                continue
        return frames

    def _append_pending_sync(self, pending: list[dict[str, Any]]) -> None:
        self._seg_dir.mkdir(parents=True, exist_ok=True)
        by_file: dict[str, list[dict[str, Any]]] = {}
        for f in pending:
            by_file.setdefault(self._seg_name(f.get("ts") or time.time()), []).append(f)
        for name, fs in by_file.items():
            with open(self._seg_dir / name, "a", encoding="utf-8") as fh:
                for f in fs:
                    fh.write(json.dumps(f, separators=(",", ":")) + "\n")

    def _write_all_segments_sync(self, frames: list[dict[str, Any]]) -> None:
        """One-time legacy migration: rewrite the full buffer into segments."""
        self._seg_dir.mkdir(parents=True, exist_ok=True)
        by_file: dict[str, list[dict[str, Any]]] = {}
        for f in frames:
            by_file.setdefault(self._seg_name(f.get("ts") or 0), []).append(f)
        for name, fs in by_file.items():
            with open(self._seg_dir / name, "w", encoding="utf-8") as fh:
                for f in fs:
                    fh.write(json.dumps(f, separators=(",", ":")) + "\n")

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
                    pass

    async def async_load(self) -> None:
        legacy = await self._store.async_load()
        legacy_frames = (legacy.get("frames") or []) if isinstance(legacy, dict) else []
        seg_frames = await self.hass.async_add_executor_job(self._read_segments_sync)
        # Merge, deduping by timestamp (overlap only if a past migration was
        # interrupted between segment write and legacy removal).
        merged: dict[float, dict[str, Any]] = {}
        for f in seg_frames + legacy_frames:
            ts = f.get("ts")
            if ts:
                merged[ts] = f
        self.frames = sorted(merged.values(), key=lambda f: f["ts"])
        self._prune()
        if legacy_frames:
            await self.hass.async_add_executor_job(
                self._write_all_segments_sync, list(self.frames)
            )
            try:
                await self._store.async_remove()
            except Exception as err:
                _LOGGER.debug("Legacy traceback store removal failed: %s", err)
            _LOGGER.info(
                "TracebackStore migrated %d frames to append-only segments",
                len(self.frames),
            )
        self._last_save_ts = time.time()
        _LOGGER.debug("TracebackStore loaded: %d frames", len(self.frames))

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
            # Only record identified or followed objects (skip anonymous BLE noise)
            is_identified = o.get("identified") or o.get("user_label")
            is_followed = key in _fset or o.get("address", "") in _fset or o.get("entity_id", "") in _fset
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

    async def async_maybe_save(self) -> None:
        """Flush new frames to disk if enough time has elapsed."""
        if time.time() - self._last_save_ts < SAVE_INTERVAL_S:
            return
        await self.async_flush()

    async def async_flush(self) -> None:
        """Append pending frames to their daily segments and prune old files.

        Only the frames recorded since the last flush are written — the
        existing on-disk history is never rewritten.
        """
        self._prune()
        pending, self._pending = self._pending, []
        if pending:
            await self.hass.async_add_executor_job(self._append_pending_sync, pending)
        await self.hass.async_add_executor_job(self._prune_segment_files_sync)
        self._last_save_ts = time.time()

    def get_frames(
        self,
        start_ts: float | None = None,
        end_ts: float | None = None,
        obj_key: str | None = None,
        max_frames: int = 4000,
    ) -> list[dict[str, Any]]:
        """Return frames within the time window, optionally filtered to one object."""
        now = time.time()
        if start_ts is None:
            start_ts = now - 300  # default 5 min
        if end_ts is None:
            end_ts = now

        result: list[dict[str, Any]] = []
        for f in self.frames:
            ts = f.get("ts", 0)
            if ts < start_ts or ts > end_ts:
                continue
            if obj_key:
                # Filter to frames that contain this object
                filtered_objs = [o for o in f.get("o", []) if o.get("k") == obj_key]
                if not filtered_objs:
                    continue
                result.append({"ts": ts, "o": filtered_objs})
            else:
                result.append(f)
            if len(result) >= max_frames:
                break

        # If too many frames, downsample evenly
        if len(result) > max_frames:
            step = len(result) / max_frames
            result = [result[int(i * step)] for i in range(max_frames)]

        return result

    def get_object_keys(self) -> list[dict[str, str]]:
        """Return all unique object keys seen in traceback with their latest label/kind."""
        seen: dict[str, dict[str, str]] = {}
        for f in reversed(self.frames):
            for o in f.get("o", []):
                k = o.get("k", "")
                if k and k not in seen:
                    seen[k] = {
                        "key": k,
                        "name": o.get("n", k),
                        "kind": o.get("t", ""),
                    }
            if len(seen) > 500:
                break
        return list(seen.values())

    def get_time_range(self) -> dict[str, float]:
        """Return the earliest and latest timestamp in the store."""
        if not self.frames:
            return {"start": 0, "end": 0, "count": 0}
        return {
            "start": self.frames[0].get("ts", 0),
            "end": self.frames[-1].get("ts", 0),
            "count": len(self.frames),
        }

    def _prune(self) -> None:
        cutoff = time.time() - MAX_AGE_S
        self.frames = [f for f in self.frames if f.get("ts", 0) > cutoff]
        if len(self.frames) > MAX_FRAMES:
            self.frames = self.frames[-MAX_FRAMES:]
