# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
BLE Fingerprint Calibration Store

Persists calibration points (phone-at-known-location + per-scanner RSSI readings)
and computes:
  - Coverage grids (Gaussian falloff, 10x10 per map)
  - Path-loss models per scanner (RSSI = RSSI_1m - 10*n*log10(d), OLS fit)
  - k-NN fingerprint matching for runtime location estimation
  - Leave-one-out cross-validation accuracy estimate

Data layout in .storage/padspan_ha.calibration:
  {
    "points": [ CalibrationPoint, ... ],
    "model":  { ... computed stats ... }
  }
"""

import logging
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import CALIBRATION_STORE_KEY, DATA_SETTINGS, DOMAIN
from .safe_store import wrap_store
from .random_forest import MISSING_RSSI, RandomForestLocator

_LOGGER = logging.getLogger(__name__)

GRID_N = 10           # 10×10 coverage grid per floor map
SIGMA_CELLS = 1.8     # Gaussian sigma in grid-cell units (~20% of map width)
KNN_K = 3             # k for k-NN fingerprint matching
MIN_SCANNER_SAMPLES = 3   # scanner readings below this are dropped from a stored point
HIGH_STD_DBM = 8.0        # per-scanner std above this is flagged (not rejected)
# Absolute squared-dB discrepancy assigned per scanner that hears the query
# but is absent from a candidate fingerprint. Must stay absolute (not
# mean-centered): a scanner hearing the query but not the point is still
# evidence against the point, and a multiplicative penalty would vanish
# whenever the centered distance is 0 (e.g. every 1-shared-scanner point).
MISSING_SCANNER_PENALTY_DB = 12.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _gaussian(dist: float, sigma: float) -> float:
    return math.exp(-(dist ** 2) / (2 * sigma ** 2))


def _mean(vals: list[float]) -> float:
    return sum(vals) / len(vals) if vals else 0.0


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    mid = len(s) // 2
    if len(s) % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _std(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    m = _mean(vals)
    # Sample std (N-1) — population std (N) understates variance by 15-20%
    # for small calibration sets (5-15 readings), overstating k-NN confidence.
    return math.sqrt(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))


@dataclass
class CalibrationStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any] = field(default_factory=lambda: {"points": [], "model": {}})

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._raw_store = Store(hass, 1, CALIBRATION_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "calibration")
        self.data = {"points": [], "model": {}}
        self._rf: RandomForestLocator = RandomForestLocator()
        self._model: Any = None  # ModelStore reference (Phase 3, set via set_model_store)

    def set_model_store(self, model: Any) -> None:
        """Wire in ModelStore for metre-space conversions (Phase 3)."""
        self._model = model

    async def async_setup(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "points" in loaded:
            self.data = loaded
        else:
            self.data = {"points": [], "model": {}}
        # Train Random Forest on startup
        await self._async_train_rf()

    async def async_setup_fast(self) -> None:
        """Load persisted data but skip RF training (deferred to background)."""
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "points" in loaded:
            self.data = loaded
        else:
            self.data = {"points": [], "model": {}}

    def list_points(self) -> list[dict[str, Any]]:
        return list(self.data.get("points", []))

    def get_point(self, point_id: str) -> dict[str, Any] | None:
        for p in self.data.get("points", []):
            if p.get("id") == point_id:
                return p
        return None

    async def async_add_point(self, point: dict[str, Any]) -> dict[str, Any]:
        """Validate, clean, and persist a calibration point."""
        point_id = f"cp_{os.urandom(6).hex()}"

        raw_readings = point.get("scanner_readings") or []
        # Fallback: accept "readings" dict {source: {samples, name}} from older
        # callers and convert to the expected list-of-dicts format.
        if not raw_readings and isinstance(point.get("readings"), dict):
            raw_readings = [
                {"source": src, "name": (rd.get("name") or src), "rssi_samples": (rd.get("samples") or [])}
                for src, rd in point["readings"].items()
                if isinstance(rd, dict)
            ]
        clean_readings: list[dict[str, Any]] = []
        for r in raw_readings:
            if not isinstance(r, dict):
                continue
            samples = [
                float(x) for x in (r.get("rssi_samples") or [])
                if isinstance(x, (int, float)) and not math.isnan(float(x))
            ]
            if not samples:
                continue
            # Median, not mean — BLE noise is heavy-tailed (multipath fades
            # drop 15-20 dB). Key kept as mean_rssi for downstream compat.
            m = _median(samples)
            s = _std(samples)
            reading: dict[str, Any] = {
                "source": str(r.get("source") or "")[:200],
                "name": str(r.get("name") or r.get("source") or "")[:120],
                "rssi_samples": samples[:200],
                "mean_rssi": round(m, 2),
                "std_rssi": round(s, 2),
                "sample_count": len(samples),
            }
            if s > HIGH_STD_DBM:
                reading["quality"] = "high_std"
            clean_readings.append(reading)

        # Quality gate: require MIN_SCANNER_SAMPLES per scanner. Never reject a
        # point the user explicitly saved — if no scanner qualifies, keep the
        # best-sampled one and flag the point as undersampled.
        point_quality = ""
        qualified = [
            r for r in clean_readings if r["sample_count"] >= MIN_SCANNER_SAMPLES
        ]
        if qualified:
            clean_readings = qualified
        elif clean_readings:
            best = max(clean_readings, key=lambda r: r["sample_count"])
            clean_readings = [best]
            point_quality = "undersampled"

        clean: dict[str, Any] = {
            "id": point_id,
            "map_id": str(point.get("map_id") or "")[:80],
            "x_frac": max(0.0, min(1.0, float(point.get("x_frac", 0.5)))),
            "y_frac": max(0.0, min(1.0, float(point.get("y_frac", 0.5)))),
            "floor_id": str(point.get("floor_id") or "")[:40],
            "room": str(point.get("room") or "")[:120],
            "label": str(point.get("label") or "")[:200],
            "device_id": str(point.get("device_id") or "")[:80],
            "collected_at": _now_iso(),
            "duration_s": max(5, min(120, int(point.get("duration_s") or 15))),
            "weight": max(0.1, min(10.0, float(point.get("weight") or 1.0))),
            "scanner_readings": clean_readings,
        }
        if point_quality:
            clean["quality"] = point_quality
        # Phase 3: compute real-world metre coordinates
        if point.get("x_m") is not None and point.get("y_m") is not None:
            # Caller provided explicit metres (standalone/mapless calibration)
            clean["x_m"] = round(float(point["x_m"]), 3)
            clean["y_m"] = round(float(point["y_m"]), 3)
        elif self._model and clean["map_id"]:
            coords = self._model.map_frac_to_metres(clean["x_frac"], clean["y_frac"], clean["map_id"])
            if coords:
                clean["x_m"] = round(coords[0], 3)
                clean["y_m"] = round(coords[1], 3)

        self.data.setdefault("points", []).append(clean)
        await self.store.async_save(self.data)
        await self._async_train_rf()
        return clean

    async def async_delete_point(self, point_id: str) -> bool:
        before = len(self.data.get("points", []))
        self.data["points"] = [
            p for p in self.data.get("points", []) if p.get("id") != point_id
        ]
        changed = len(self.data["points"]) < before
        if changed:
            await self.store.async_save(self.data)
            await self._async_train_rf()
        return changed

    async def async_clear_all(self) -> int:
        count = len(self.data.get("points", []))
        self.data = {"points": [], "model": {}}
        await self.store.async_save(self.data)
        self._rf = RandomForestLocator()  # reset
        return count

    async def async_clear_map(self, map_id: str) -> int:
        """Remove calibration points for a map. Points with metre coordinates
        are preserved (detached from map) — they survive map deletion.
        Points without metres are deleted (map-only, unusable without the map).
        """
        points = self.data.get("points", [])
        before = len(points)
        surviving: list[dict[str, Any]] = []
        detached = 0
        for p in points:
            if p.get("map_id") != map_id:
                surviving.append(p)
            elif p.get("x_m") is not None:
                # Phase 3: detach from map but keep (spatially anchored)
                p["map_id"] = ""
                detached += 1
                surviving.append(p)
            # else: map-only point without metres → deleted
        self.data["points"] = surviving
        removed = before - len(surviving)
        if removed or detached:
            # Invalidate coverage cache for this map
            cov = (self.data.get("model") or {}).get("coverage_by_map")
            if isinstance(cov, dict):
                cov.pop(map_id, None)
            await self.store.async_save(self.data)
            await self._async_train_rf()
        return removed

    async def async_prune_auto_points(self, max_per_beacon: int = 50) -> int:
        """Remove oldest [auto] calibration points when a beacon exceeds the cap."""
        points = self.data.get("points", [])
        # Group auto-points by device_id
        by_dev: dict[str, list[dict]] = {}
        for p in points:
            if str(p.get("label", "")).startswith("[auto]"):
                did = p.get("device_id", "")
                by_dev.setdefault(did, []).append(p)
        remove_ids: set[str] = set()
        for did, auto_pts in by_dev.items():
            if len(auto_pts) > max_per_beacon:
                # Sort by collected_at ascending (oldest first), remove extras
                auto_pts.sort(key=lambda p: p.get("collected_at", ""))
                for p in auto_pts[: len(auto_pts) - max_per_beacon]:
                    remove_ids.add(p.get("id", ""))
        if remove_ids:
            self.data["points"] = [p for p in points if p.get("id") not in remove_ids]
            await self.store.async_save(self.data)
        return len(remove_ids)

    async def async_remove_scanner(self, source: str) -> dict[str, int]:
        """Remove all data for a specific scanner source.

        - Removes scanner_readings entries matching source from all points
        - Deletes points that have zero remaining readings
        - Clears model scanner_stats[source] and path_loss[source]

        Returns counts: {readings_removed, points_pruned, model_keys_removed}.
        """
        readings_removed = 0
        points_pruned = 0
        model_keys_removed = 0

        surviving: list[dict[str, Any]] = []
        for pt in self.data.get("points", []):
            readings = pt.get("scanner_readings", [])
            before = len(readings)
            pt["scanner_readings"] = [
                r for r in readings if r.get("source") != source
            ]
            readings_removed += before - len(pt["scanner_readings"])
            if pt["scanner_readings"]:
                surviving.append(pt)
            else:
                points_pruned += 1
        self.data["points"] = surviving

        model = self.data.get("model", {})
        for section in ("scanner_stats", "path_loss"):
            sec = model.get(section)
            if isinstance(sec, dict) and source in sec:
                del sec[source]
                model_keys_removed += 1

        await self.store.async_save(self.data)
        return {
            "readings_removed": readings_removed,
            "points_pruned": points_pruned,
            "model_keys_removed": model_keys_removed,
        }

    # ── Phase 3: metre-space migration + remapping ──────────────────────────

    async def async_backfill_metres(self) -> int:
        """Backfill x_m/y_m for existing points that have map_id but no metres."""
        if not self._model:
            return 0
        count = 0
        for p in self.data.get("points", []):
            if p.get("x_m") is not None:
                continue  # already has metres
            mid = p.get("map_id", "")
            if not mid:
                continue  # no map to derive from
            coords = self._model.map_frac_to_metres(
                float(p.get("x_frac", 0.5)), float(p.get("y_frac", 0.5)), mid
            )
            if coords:
                p["x_m"] = round(coords[0], 3)
                p["y_m"] = round(coords[1], 3)
                count += 1
        if count:
            await self.store.async_save(self.data)
        return count

    async def async_remap_from_metres(self, map_id: str, adopt_orphans: bool = True) -> int:
        """Re-derive x_frac/y_frac from metre coords for points on this map.

        Also re-adopts orphaned points (map_id='') whose metres fall within
        this map's coordinate range (0-1 fracs) — unless adopt_orphans is
        False (the re-anchor path: adopting foreign orphans under a
        user-chosen pose is a one-way ratchet, since a later corrective
        re-anchor would count them against the guard and be refused).

        Safety (issue #56): a re-derived frac outside the map means the map
        transform disagrees with the stored metres.  These used to be CLAMPED
        to the nearest edge — which silently piled a whole floor's points
        into the (0,0) corner when the transform origin drifted.  Now
        out-of-range points keep their existing fracs, and if most of the
        map's own points re-derive out of range the whole remap is aborted.
        """
        if not self._model:
            return 0
        # Pass 1: derive everything, measure sanity before writing anything
        derived: list[tuple[dict, float, float, bool]] = []
        owned = 0
        owned_bad = 0
        for p in self.data.get("points", []):
            if p.get("x_m") is None:
                continue
            pid = p.get("map_id", "")
            if pid != map_id and (pid != "" or not adopt_orphans):
                continue
            fracs = self._model.metres_to_map_frac(float(p["x_m"]), float(p["y_m"]), map_id)
            if not fracs:
                continue
            fx, fy = fracs
            in_range = -0.05 <= fx <= 1.05 and -0.05 <= fy <= 1.05
            if pid == map_id:
                owned += 1
                if not in_range:
                    owned_bad += 1
                    continue  # keep the existing fracs — do not clamp
            elif not in_range:
                continue  # orphan outside this map's coverage
            derived.append((p, fx, fy, pid == ""))
        if owned and owned_bad * 2 > owned:
            _LOGGER.warning(
                "Calibration remap for map %s aborted: %d/%d points re-derive "
                "outside the map — transform disagrees with stored metres; "
                "keeping existing fracs", map_id, owned_bad, owned)
            return 0
        count = 0
        for p, fx, fy, is_orphan in derived:
            p["x_frac"] = round(max(0.0, min(1.0, fx)), 4)
            p["y_frac"] = round(max(0.0, min(1.0, fy)), 4)
            if is_orphan:
                p["map_id"] = map_id  # re-adopt orphan
            count += 1
        if count:
            await self.store.async_save(self.data)
        return count

    # ── Coverage grid ──────────────────────────────────────────────────────────

    def compute_coverage(self, map_id: str) -> dict[str, Any]:
        """
        Gaussian-weighted coverage grid for one floor map.
        Returns flattened GRID_N×GRID_N scores (row-major), next_target, and stats.
        """
        pts = [p for p in self.data.get("points", []) if p.get("map_id") == map_id]
        grid = [0.0] * (GRID_N * GRID_N)

        for pt in pts:
            px = pt["x_frac"] * GRID_N
            py = pt["y_frac"] * GRID_N
            for cy in range(GRID_N):
                for cx in range(GRID_N):
                    dist = math.sqrt((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2)
                    contrib = _gaussian(dist, SIGMA_CELLS)
                    idx = cy * GRID_N + cx
                    grid[idx] = min(1.0, grid[idx] + contrib)

        covered = sum(1 for v in grid if v >= 0.5)
        total = GRID_N * GRID_N

        # Greedy next-target: cell with lowest score, tie-break by interior preference
        min_score = 2.0
        nx, ny = GRID_N // 2, GRID_N // 2
        for cy in range(GRID_N):
            for cx in range(GRID_N):
                v = grid[cy * GRID_N + cx]
                # Weight interior cells slightly higher priority than edge cells
                edge_penalty = 0.05 if (cx == 0 or cx == GRID_N - 1 or cy == 0 or cy == GRID_N - 1) else 0.0
                effective = v + edge_penalty
                if effective < min_score:
                    min_score = effective
                    nx, ny = cx, cy

        return {
            "map_id": map_id,
            "point_count": len(pts),
            "covered_cells": covered,
            "total_cells": total,
            "coverage_pct": round(covered / total, 3),
            "grid": [round(v, 3) for v in grid],
            "grid_n": GRID_N,
            "next_target": {
                "x_frac": round((nx + 0.5) / GRID_N, 3),
                "y_frac": round((ny + 0.5) / GRID_N, 3),
                "score": round(grid[ny * GRID_N + nx], 3),
            },
        }

    # ── Path-loss model ────────────────────────────────────────────────────────

    def fit_path_loss(
        self,
        scanner_source: str,
        scanner_x_frac: float,
        scanner_y_frac: float,
        map_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        OLS fit of RSSI = RSSI_1m - 10*n*log10(d) for one scanner.

        Phase 3: fits in metre distances when the scanner position converts
        to metres and points carry x_m/y_m — rssi_1m is then a physical
        dBm@1m reference (units="m"). Otherwise falls back to map-fraction
        distances (comparative/display only, units="frac").
        Requires ≥3 data points.
        """
        data: list[tuple[float, float]] = []
        pts = self.data.get("points", [])
        units = "frac"

        # Metre-space fit: same gate style as knn_locate — points with metre
        # coords available, plus a convertible scanner position.
        metre_pts = [p for p in pts if p.get("x_m") is not None and p.get("y_m") is not None]
        scanner_m = None
        if metre_pts and map_id and self._model is not None:
            scanner_m = self._model.map_frac_to_metres(scanner_x_frac, scanner_y_frac, map_id)
        if scanner_m:
            sx_m, sy_m = scanner_m
            # 3D fit (issue #54): RSSI measures the slant range, so fit
            # against it.  Scanner height from the fabric (absolute);
            # calibration points were walked at carry height on their floor.
            _sz_abs = None
            _floor_bases: dict[str, float] = {}
            _dev_h = 1.0
            try:
                _sz_abs = self._model.scanner_absolute_z_m().get(scanner_source)
                _floor_bases = self._model.floor_base_elevations_m()
                _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                if _st:
                    _dev_h = max(0.0, min(3.0, float(_st.data.get("assumed_device_height_m", 1.0))))
            except Exception:
                pass
            # Metres are map-independent — use all metre points, cross-map.
            for pt in metre_pts:
                for reading in pt.get("scanner_readings", []):
                    if reading.get("source") != scanner_source:
                        continue
                    d_sq = (float(pt["x_m"]) - sx_m) ** 2 + (float(pt["y_m"]) - sy_m) ** 2
                    if _sz_abs is not None:
                        _pt_z = _floor_bases.get(str(pt.get("floor_id") or ""), 0.0) + _dev_h
                        d_sq += (_sz_abs - _pt_z) ** 2
                    d = math.sqrt(d_sq)
                    if d < 0.3:   # too close — likely at scanner position itself
                        continue
                    data.append((math.log10(d), reading["mean_rssi"]))
            if len(data) >= 3:
                units = "m"
            else:
                data = []

        if not data:
            # Legacy map-fraction fit
            frac_pts = pts
            if map_id:
                frac_pts = [p for p in pts if p.get("map_id") == map_id]
            for pt in frac_pts:
                for reading in pt.get("scanner_readings", []):
                    if reading.get("source") != scanner_source:
                        continue
                    dx = pt["x_frac"] - scanner_x_frac
                    dy = pt["y_frac"] - scanner_y_frac
                    d = math.sqrt(dx ** 2 + dy ** 2)
                    if d < 0.02:   # too close — likely at scanner position itself
                        continue
                    log_d = math.log10(d)
                    data.append((log_d, reading["mean_rssi"]))

        if len(data) < 3:
            return None

        # OLS: RSSI = a + b*log10(d)  where b = -10*n, a = RSSI_1m
        n_pts = len(data)
        sum_x = sum(d[0] for d in data)
        sum_y = sum(d[1] for d in data)
        sum_xx = sum(d[0] ** 2 for d in data)
        sum_xy = sum(d[0] * d[1] for d in data)

        denom = n_pts * sum_xx - sum_x ** 2
        if abs(denom) < 1e-10:
            return None

        b = (n_pts * sum_xy - sum_x * sum_y) / denom
        a = (sum_y - b * sum_x) / n_pts
        n_exp = max(0.5, min(8.0, -b / 10.0))

        # R²
        y_mean = sum_y / n_pts
        ss_tot = sum((d[1] - y_mean) ** 2 for d in data)
        ss_res = sum((d[1] - (a + b * d[0])) ** 2 for d in data)
        r_sq = 1.0 - (ss_res / ss_tot) if ss_tot > 1e-10 else 0.0

        return {
            "n": round(n_exp, 3),
            "rssi_1m": round(a, 1),
            "r_squared": round(max(0.0, r_sq), 3),
            "point_count": n_pts,
            "units": units,
        }

    def path_loss_by_source(self) -> dict[str, dict]:
        """Physical per-scanner path-loss parameters from metre-space fits.

        Reads the fits stored per source by compute_model() and returns
        {source: {"rssi_1m": float, "n": float, "points": int}} for
        metre-unit fits with >= 5 points and sane values
        (rssi_1m in [-90, -30] dBm, n in [1.5, 4.5]).
        Consumed by the presence coordinator for distance conversion.
        """
        out: dict[str, dict] = {}
        path_loss = (self.data.get("model") or {}).get("path_loss") or {}
        for src, fit in path_loss.items():
            if not isinstance(fit, dict) or fit.get("units") != "m":
                continue
            try:
                rssi_1m = float(fit["rssi_1m"])
                n = float(fit["n"])
                points = int(fit.get("point_count", 0))
            except (KeyError, TypeError, ValueError):
                continue
            if points < 5:
                continue
            if not (-90.0 <= rssi_1m <= -30.0):
                continue
            if not (1.5 <= n <= 4.5):
                continue
            out[src] = {"rssi_1m": rssi_1m, "n": n, "points": points}
        return out

    # ── k-NN fingerprint matching ──────────────────────────────────────────────

    def knn_locate(
        self,
        query_rssi: dict[str, float],
        map_id: str | None = None,
        k: int = KNN_K,
    ) -> dict[str, Any] | None:
        """
        Estimate position using k-NN fingerprint matching.

        query_rssi: {source: mean_rssi} for the device being located.
        Returns weighted centroid of top-k nearest calibration points.
        Distance is a mean-centered (TX-invariant) per-scanner MSE over the
        shared scanner set, plus an absolute penalty per missing scanner.

        Phase 3: when enough points have x_m/y_m, operates in metre space
        (no map_id filtering needed — metres are map-independent).
        """
        pts = self.data.get("points", [])

        # Phase 3: check if we can use metre-space path
        metre_pts = [p for p in pts if p.get("x_m") is not None]
        use_metres = len(metre_pts) >= k and self._model is not None

        if use_metres:
            work_pts = metre_pts  # all metre points, cross-map
        elif map_id:
            work_pts = [p for p in pts if p.get("map_id") == map_id]
        else:
            work_pts = pts

        if not work_pts or not query_rssi:
            return None

        scored: list[tuple[float, int, dict[str, Any]]] = []
        for pt in work_pts:
            fp: dict[str, float] = {
                r["source"]: r["mean_rssi"] for r in pt.get("scanner_readings", [])
            }
            shared = set(query_rssi.keys()) & set(fp.keys())
            if not shared:
                continue
            # TX-invariance: mean-centre both vectors over THIS point's shared
            # scanner set before comparing. A tag whose TX power differs from
            # the calibration device is offset by a near-constant on every
            # scanner; centering removes that offset and compares RSSI *shape*.
            # Centering must be per-point over its own shared set — a global
            # mean would be corrupted by scanners missing from the point.
            q_mean = sum(query_rssi[s] for s in shared) / len(shared)
            p_mean = sum(fp[s] for s in shared) / len(shared)
            sq_sum = sum(
                ((query_rssi[s] - q_mean) - (fp[s] - p_mean)) ** 2 for s in shared
            )
            # Missing-scanner penalty stays ABSOLUTE (see constant docstring);
            # normalising over the scanner UNION keeps this a per-scanner mean
            # squared error.  The penalty is SYMMETRIC: scanners the query has
            # that the point lacks AND scanners the point has that the query
            # lacks both count — otherwise a sparse 2-scanner query matches
            # rich fingerprints cheaply with inflated confidence.
            missing = max(0, len(query_rssi) - len(shared)) + max(0, len(fp) - len(shared))
            dist_sq = (sq_sum + missing * MISSING_SCANNER_PENALTY_DB ** 2) / (
                len(shared) + missing
            )
            scored.append((dist_sq, len(shared), pt))

        if not scored:
            return None

        scored.sort(key=lambda t: t[0])
        top_k = scored[: k]

        if use_metres:
            # ── Metre-space centroid (Phase 3) ────────────────────────────
            # No map_id filtering needed — all points share one coordinate space.
            # Group by floor_id instead.
            floor_weights: dict[str, float] = {}
            for dist_sq, _n_shared, pt in top_k:
                pw = float(pt.get("weight") or 1.0)
                w = pw / (math.sqrt(dist_sq) + 1e-3)
                fl = pt.get("floor_id", "")
                if fl:
                    floor_weights[fl] = floor_weights.get(fl, 0.0) + w
            best_floor = max(floor_weights, key=lambda f: floor_weights[f]) if floor_weights else ""

            total_w = 0.0
            wx_m, wy_m = 0.0, 0.0
            for dist_sq, _n_shared, pt in top_k:
                if best_floor and pt.get("floor_id", "") != best_floor:
                    continue
                pw = float(pt.get("weight") or 1.0)
                w = pw / (math.sqrt(dist_sq) + 1e-3)
                wx_m += w * float(pt["x_m"])
                wy_m += w * float(pt["y_m"])
                total_w += w

            if total_w < 1e-10:
                return None

            rx_m = wx_m / total_w
            ry_m = wy_m / total_w

            # Derive map fracs for UI rendering — find the best map on this floor
            x_frac, y_frac = 0.5, 0.5
            best_map = ""
            transforms = (self._model.data.get("map_transforms") or {}) if self._model else {}
            for mid, t in transforms.items():
                if t.get("floor_id") == best_floor:
                    fracs = self._model.metres_to_map_frac(rx_m, ry_m, mid)
                    if fracs and 0.0 <= fracs[0] <= 1.0 and 0.0 <= fracs[1] <= 1.0:
                        x_frac, y_frac = fracs
                        best_map = mid
                        break

            # Also try dominant map_id from top-k for backward compat
            if not best_map:
                map_weights: dict[str, float] = {}
                for dist_sq, _n_shared, pt in top_k:
                    pw = float(pt.get("weight") or 1.0)
                    w = pw / (math.sqrt(dist_sq) + 1e-3)
                    mid = pt.get("map_id", "")
                    if mid:
                        map_weights[mid] = map_weights.get(mid, 0.0) + w
                best_map = max(map_weights, key=lambda m: map_weights[m]) if map_weights else ""
        else:
            # ── Legacy map-fraction centroid ──────────────────────────────
            map_weights: dict[str, float] = {}
            for dist_sq, _n_shared, pt in top_k:
                pw = float(pt.get("weight") or 1.0)
                w = pw / (math.sqrt(dist_sq) + 1e-3)
                mid = pt.get("map_id", "")
                if mid:
                    map_weights[mid] = map_weights.get(mid, 0.0) + w
            best_map = max(map_weights, key=lambda m: map_weights[m]) if map_weights else ""

            total_w = 0.0
            wx, wy = 0.0, 0.0
            for dist_sq, _n_shared, pt in top_k:
                if best_map and pt.get("map_id", "") != best_map:
                    continue
                pw = float(pt.get("weight") or 1.0)
                w = pw / (math.sqrt(dist_sq) + 1e-3)
                wx += w * pt["x_frac"]
                wy += w * pt["y_frac"]
                total_w += w

            if total_w < 1e-10:
                return None
            x_frac = wx / total_w
            y_frac = wy / total_w
            rx_m, ry_m = None, None  # type: ignore[assignment]
            best_floor = ""

        # Confidence (shared between both paths — computed from RSSI space).
        # scored[0][0] is already the per-scanner mean squared error; coverage
        # counts the best point's OWN shared scanners, not the top-k union.
        _mean_sq = scored[0][0]
        _shared_total = max(scored[0][1], 1)
        _REF_VARIANCE = 25.0
        _conf_rssi = 1.0 / (1.0 + _mean_sq / _REF_VARIANCE)
        _conf_coverage = min(_shared_total, 4) / 4.0
        confidence = round(_conf_rssi * _conf_coverage, 3)

        # Room: weighted vote over the top-k (restricted to the winning floor
        # in metre mode, matching the position centroid).  The single nearest
        # sample's label is high-variance — one noisy point must not decide
        # the room while five decide the position.
        room_w: dict[str, float] = {}
        for dist_sq, _n_shared, pt in top_k:
            if use_metres and best_floor and pt.get("floor_id", "") != best_floor:
                continue
            _rm = str(pt.get("room") or "")
            if not _rm:
                continue
            pw = float(pt.get("weight") or 1.0)
            # 1 dB noise floor on the vote weight — RSSI noise makes chance
            # near-exact matches common, and with the position epsilon (1e-3)
            # a single dist≈0 point would outvote k-1 agreeing neighbours,
            # degenerating the vote back to 1-NN.
            room_w[_rm] = room_w.get(_rm, 0.0) + pw / (math.sqrt(dist_sq) + 1.0)
        nearest_room = (
            max(room_w, key=lambda r: room_w[r]) if room_w
            else str(scored[0][2].get("room", ""))
        )

        result: dict[str, Any] = {
            "x_frac": round(x_frac, 4),
            "y_frac": round(y_frac, 4),
            "confidence": confidence,
            "nearest_room": nearest_room,
            "map_id": best_map,
            "k_used": len(top_k),
            "shared_scanners": _shared_total,
        }
        if use_metres and rx_m is not None:
            result["x_m"] = round(rx_m, 3)
            result["y_m"] = round(ry_m, 3)
            result["floor_id"] = best_floor
        return result

    # ── Random Forest positioning ─────────────────────────────────────────────

    def rf_locate(
        self,
        query_rssi: dict[str, float],
        map_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Random Forest positioning — same return shape as knn_locate()."""
        if not self._rf.is_trained:
            return None
        result = self._rf.predict(query_rssi, map_id=map_id)
        # Phase 3: if RF trained in metres, derive map fracs for UI
        if result and self._rf._use_metres and self._model and result.get("x_m") is not None:
            best_map = result.get("map_id", "")
            if best_map:
                fracs = self._model.metres_to_map_frac(float(result["x_m"]), float(result["y_m"]), best_map)
                if fracs:
                    result["x_frac"] = round(fracs[0], 4)
                    result["y_frac"] = round(fracs[1], 4)
        return result

    async def _async_train_rf(self) -> None:
        """Retrain RF from current calibration points (runs in executor)."""
        pts = list(self.data.get("points", []))
        if len(pts) < 4:
            self._rf = RandomForestLocator()
            return
        # Phase 3: train in metres if enough points have them
        metre_pts = [p for p in pts if p.get("x_m") is not None]
        use_metres = len(metre_pts) >= 4
        rf = RandomForestLocator()
        train_pts = metre_pts if use_metres else pts
        await self.hass.async_add_executor_job(rf.train, train_pts, use_metres)
        self._rf = rf

    @property
    def rf_trained(self) -> bool:
        return self._rf.is_trained

    # ── Leave-one-out accuracy estimate ───────────────────────────────────────

    def loo_accuracy(
        self, map_id: str | None = None, algorithm: str = "knn"
    ) -> dict[str, Any] | None:
        """
        Leave-one-out cross-validation accuracy for the given algorithm.

        algorithm="knn" (default): true LOO against the k-NN metric.
        algorithm="rf": out-of-bag validation against the trained forest
        (see _rf_oob_accuracy) — retraining per held-out point would be
        O(n) full forest trains.
        Phase 3: computes in metres when points have x_m/y_m, otherwise map fractions.
        """
        if algorithm == "rf":
            return self._rf_oob_accuracy(map_id)

        pts = self.data.get("points", [])
        if map_id:
            pts = [p for p in pts if p.get("map_id") == map_id]
        if len(pts) < KNN_K + 1:
            return None

        # Phase 3: use metres if all points have them
        metre_pts = [p for p in pts if p.get("x_m") is not None]
        use_metres = len(metre_pts) == len(pts) and len(pts) > 0

        errors: list[float] = []
        errors_m: list[float] = []
        for i, pt in enumerate(pts):
            loo_pts = [p for j, p in enumerate(pts) if j != i]
            query: dict[str, float] = {
                r["source"]: r["mean_rssi"] for r in pt.get("scanner_readings", [])
            }
            if not query:
                continue

            scored: list[tuple[float, dict[str, Any]]] = []
            for p2 in loo_pts:
                fp = {r["source"]: r["mean_rssi"] for r in p2.get("scanner_readings", [])}
                shared = set(query.keys()) & set(fp.keys())
                if not shared:
                    continue
                # Same metric as knn_locate: per-point mean-centered
                # (TX-invariant) MSE + absolute missing-scanner penalty,
                # so validation measures the deployed estimator.
                q_mean = sum(query[s] for s in shared) / len(shared)
                p_mean = sum(fp[s] for s in shared) / len(shared)
                sq_sum = sum(
                    ((query[s] - q_mean) - (fp[s] - p_mean)) ** 2 for s in shared
                )
                missing = max(0, len(query) - len(shared))
                dist_sq = (sq_sum + missing * MISSING_SCANNER_PENALTY_DB ** 2) / (
                    len(shared) + missing
                )
                scored.append((dist_sq, p2))

            if not scored:
                continue
            scored.sort(key=lambda t: t[0])
            top_k = scored[: KNN_K]
            total_w, wx, wy = 0.0, 0.0, 0.0
            total_w_m, wx_m, wy_m = 0.0, 0.0, 0.0
            for dist_sq, p2 in top_k:
                w = 1.0 / (math.sqrt(dist_sq) + 1e-3)
                wx += w * p2["x_frac"]
                wy += w * p2["y_frac"]
                total_w += w
                if use_metres:
                    wx_m += w * float(p2["x_m"])
                    wy_m += w * float(p2["y_m"])
                    total_w_m += w

            if total_w < 1e-10:
                continue
            pred_x, pred_y = wx / total_w, wy / total_w
            err = math.sqrt((pred_x - pt["x_frac"]) ** 2 + (pred_y - pt["y_frac"]) ** 2)
            errors.append(err)

            if use_metres and total_w_m > 1e-10:
                pred_xm = wx_m / total_w_m
                pred_ym = wy_m / total_w_m
                err_m = math.sqrt((pred_xm - float(pt["x_m"])) ** 2 + (pred_ym - float(pt["y_m"])) ** 2)
                errors_m.append(err_m)

        if not errors:
            return None

        errors.sort()
        mean_err = _mean(errors)
        median_err = errors[len(errors) // 2]
        result: dict[str, Any] = {
            "algorithm": "knn",
            "mean_error_frac": round(mean_err, 4),
            "median_error_frac": round(median_err, 4),
            "max_error_frac": round(errors[-1], 4),
            "point_count": len(errors),
        }
        if errors_m:
            errors_m.sort()
            result["mean_error_m"] = round(_mean(errors_m), 3)
            result["median_error_m"] = round(errors_m[len(errors_m) // 2], 3)
            result["max_error_m"] = round(errors_m[-1], 3)
        else:
            # Rough estimate assuming map width ≈ 15m (typical home)
            result["mean_error_m_est"] = round(mean_err * 15, 2)
        return result

    def _rf_oob_accuracy(self, map_id: str | None = None) -> dict[str, Any] | None:
        """Out-of-bag validation accuracy for the trained Random Forest.

        True LOO would retrain the whole forest once per held-out point —
        O(n) full trains, far too slow for large calibration sets. Instead
        each training point is predicted using only the trees whose bootstrap
        sample (tree.sample_idx) excluded it: the standard OOB error estimate,
        statistically close to LOO, at the cost of plain predictions only
        (~45% of trees are out-of-bag per point at sample_frac=0.8).
        Returns the same shape as the knn path (algorithm="rf",
        validation="oob").
        """
        rf = self._rf
        if not rf.is_trained or not rf._points:
            return None
        src_idx = {s: i for i, s in enumerate(rf._sources)}
        n_feat = len(rf._sources)
        if n_feat == 0:
            return None
        x_inbag = [set(t.sample_idx) for t in rf._x_trees]
        y_inbag = [set(t.sample_idx) for t in rf._y_trees]
        use_metres = rf._use_metres

        errors: list[float] = []
        errors_m: list[float] = []
        for i, pt in enumerate(rf._points):
            if map_id and pt.get("map_id") != map_id:
                continue
            row = [MISSING_RSSI] * n_feat
            heard = False
            for r in pt.get("scanner_readings", []):
                s = r.get("source", "")
                if s in src_idx:
                    row[src_idx[s]] = float(r.get("mean_rssi", MISSING_RSSI))
                    heard = True
            if not heard:
                continue
            x_preds = [
                t.predict(row)
                for t, bag in zip(rf._x_trees, x_inbag)
                if i not in bag
            ]
            y_preds = [
                t.predict(row)
                for t, bag in zip(rf._y_trees, y_inbag)
                if i not in bag
            ]
            if len(x_preds) < 3 or len(y_preds) < 3:
                continue  # in-bag for nearly every tree — no honest estimate
            pred_x = sum(x_preds) / len(x_preds)
            pred_y = sum(y_preds) / len(y_preds)
            if use_metres:
                err_m = math.sqrt(
                    (pred_x - float(pt["x_m"])) ** 2
                    + (pred_y - float(pt["y_m"])) ** 2
                )
                errors_m.append(err_m)
                # Rough frac equivalent (map width ≈ 15 m) for shape compat
                errors.append(err_m / 15.0)
            else:
                errors.append(
                    math.sqrt(
                        (pred_x - float(pt["x_frac"])) ** 2
                        + (pred_y - float(pt["y_frac"])) ** 2
                    )
                )

        if not errors:
            return None
        errors.sort()
        result: dict[str, Any] = {
            "algorithm": "rf",
            "validation": "oob",
            "mean_error_frac": round(_mean(errors), 4),
            "median_error_frac": round(errors[len(errors) // 2], 4),
            "max_error_frac": round(errors[-1], 4),
            "point_count": len(errors),
        }
        if errors_m:
            errors_m.sort()
            result["mean_error_m"] = round(_mean(errors_m), 3)
            result["median_error_m"] = round(errors_m[len(errors_m) // 2], 3)
            result["max_error_m"] = round(errors_m[-1], 3)
        else:
            result["mean_error_m_est"] = round(_mean(errors) * 15, 2)
        return result

    def _active_algorithm(self) -> str:
        """Active positioning algorithm from settings ('knn' | 'rf')."""
        try:
            settings = (self.hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
            algo = str(
                (getattr(settings, "data", None) or {}).get("positioning_algorithm")
                or "knn"
            )
        except Exception:
            return "knn"
        return algo if algo in ("knn", "rf") else "knn"

    # ── Full model computation ────────────────────────────────────────────────

    def compute_model(
        self,
        maps_data: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Compute and cache full model statistics.

        maps_data: optional list of map dicts (from MapsStore) so scanner positions
                   can be resolved from map.receivers for path-loss fitting.
        """
        pts = self.data.get("points", [])
        map_ids = list({p["map_id"] for p in pts if p.get("map_id")})
        # Validate the algorithm actually in use (P0-12.4) — the UI reads
        # loo_accuracy from this model, so it must not report k-NN accuracy
        # while positioning_algorithm='rf'.
        algo = self._active_algorithm()

        # Per-map coverage
        coverage_by_map: dict[str, Any] = {}
        for mid in map_ids:
            cov = self.compute_coverage(mid)
            loo = self.loo_accuracy(mid, algorithm=algo)
            coverage_by_map[mid] = {**cov, "loo_accuracy": loo}

        # Aggregate scanner stats
        scanner_stats: dict[str, dict[str, Any]] = {}
        for pt in pts:
            for r in pt.get("scanner_readings", []):
                src = r.get("source", "")
                if src not in scanner_stats:
                    scanner_stats[src] = {
                        "name": r.get("name", src),
                        "rssi_samples": [],
                        "point_count": 0,
                    }
                scanner_stats[src]["rssi_samples"].extend(r.get("rssi_samples", []))
                scanner_stats[src]["point_count"] += 1

        for src, st in scanner_stats.items():
            samples = st.pop("rssi_samples")
            st["mean_rssi"] = round(_mean(samples), 1) if samples else None
            st["std_rssi"] = round(_std(samples), 2) if samples else None

        # Path-loss fits if we have scanner positions from maps
        path_loss: dict[str, Any] = {}
        if maps_data:
            for m in maps_data:
                mid = m.get("id", "")
                for rec in m.get("receivers") or []:
                    src_id = str(rec.get("id") or "")
                    label = str(rec.get("label") or "")
                    rx = float(rec.get("x") or 0.5)
                    ry = float(rec.get("y") or 0.5)
                    # Try to match scanner source by source string containing label or id
                    for src in scanner_stats:
                        if src_id and src_id in src:
                            fit = self.fit_path_loss(src, rx, ry, mid)
                            if fit:
                                path_loss[src] = {**fit, "map_id": mid, "scanner_name": label or src_id}
                        elif label and label.lower() in src.lower():
                            fit = self.fit_path_loss(src, rx, ry, mid)
                            if fit:
                                path_loss[src] = {**fit, "map_id": mid, "scanner_name": label}

        # Global LOO accuracy (for the active algorithm)
        global_loo = self.loo_accuracy(algorithm=algo)

        model = {
            "point_count": len(pts),
            "scanner_count": len(scanner_stats),
            "map_count": len(map_ids),
            "coverage_by_map": coverage_by_map,
            "scanner_stats": scanner_stats,
            "path_loss": path_loss,
            "loo_accuracy": global_loo,
            "last_computed": _now_iso(),
        }
        self.data["model"] = model
        return model

    # ── Beacon profiling (grouped by model) ────────────────────────────────

    def compute_beacon_profiles(
        self,
        snapshot_objects: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Compute per-beacon signal profiles from calibration data, then group
        by model so new beacons of the same type inherit sensible defaults.

        snapshot_objects: list of beacon dicts from live snapshot, used to
        derive model_key for each device_id.  Each object should have:
          - address / canonical_id / ibeacon key  (matched to device_id)
          - company_name, device_type, ibeacon_uuid, tx_power, ble_name, kind

        Returns {beacons: [...], models: {...}, scanner_names: {...}}.
        """
        pts = self.data.get("points", [])
        if not pts:
            return {"beacons": [], "models": {}, "scanner_names": {}}

        # ── Build device_id → snapshot object lookup ──
        obj_by_did: dict[str, dict[str, Any]] = {}
        if snapshot_objects:
            for obj in snapshot_objects:
                for key_field in ("address", "canonical_id", "entity_id"):
                    val = obj.get(key_field)
                    if val:
                        obj_by_did[val] = obj
                # iBeacon compound key
                uuid = obj.get("ibeacon_uuid")
                if uuid:
                    major = obj.get("ibeacon_major", 0)
                    minor = obj.get("ibeacon_minor", 0)
                    ib_key = f"ibeacon:{uuid}:{major}:{minor}"
                    obj_by_did[ib_key] = obj

        # ── Derive model_key from snapshot object ──
        def _model_key(obj: dict[str, Any] | None) -> str:
            if not obj:
                return "unknown"
            kind = obj.get("kind", "")
            uuid = obj.get("ibeacon_uuid", "")
            company = obj.get("company_name", "")
            dtype = obj.get("device_type", "")
            ble_name = obj.get("ble_name") or obj.get("name") or ""
            # iBeacon: group by UUID prefix (first 8 chars = product line)
            if uuid:
                prefix = uuid[:8].lower()
                return f"ibeacon:{prefix}"
            # Apple continuity subtypes
            if company and dtype:
                return f"{company}:{dtype}".lower()
            # Service-based (Eddystone, Tile, etc.)
            svc = obj.get("service_names") or []
            if svc:
                return f"{company or 'ble'}:{svc[0]}".lower()
            # BLE name prefix (e.g. "iTAG", "NUT", "FSC-BP103")
            if ble_name:
                # Use first word of BLE name as model group
                prefix = ble_name.split()[0].split("-")[0][:16]
                if company:
                    return f"{company}:{prefix}".lower()
                return f"ble:{prefix}".lower()
            if company:
                return company.lower()
            return "unknown"

        # ── Group calibration points by device_id ──
        by_dev: dict[str, list[dict]] = {}
        for p in pts:
            did = p.get("device_id", "")
            if did:
                by_dev.setdefault(did, []).append(p)

        # ── Collect all scanner names ──
        scanner_names: dict[str, str] = {}
        for p in pts:
            for r in p.get("scanner_readings", []):
                src = r.get("source", "")
                if src and src not in scanner_names:
                    scanner_names[src] = r.get("name", src)

        # ── Per-beacon profile ──
        beacons: list[dict[str, Any]] = []
        for did, dev_pts in by_dev.items():
            obj = obj_by_did.get(did)
            all_rssi: list[float] = []
            all_std: list[float] = []
            scanner_reach: list[int] = []   # scanners reached per point
            scanner_rssi: dict[str, list[float]] = {}  # per-scanner RSSI

            for p in dev_pts:
                readings = p.get("scanner_readings", [])
                scanner_reach.append(len(readings))
                for r in readings:
                    src = r.get("source", "")
                    mean = r.get("mean_rssi")
                    std = r.get("std_rssi", 0.0)
                    if mean is not None:
                        all_rssi.append(mean)
                        all_std.append(std)
                        scanner_rssi.setdefault(src, []).append(mean)

            # Coverage: unique map cells touched (10×10 grid)
            cells_hit: set[tuple[str, int, int]] = set()
            for p in dev_pts:
                mid = p.get("map_id", "")
                cx = int(p.get("x_frac", 0.5) * GRID_N)
                cy = int(p.get("y_frac", 0.5) * GRID_N)
                cells_hit.add((mid, min(cx, GRID_N - 1), min(cy, GRID_N - 1)))

            # Multi-radio points (>= 2 scanners)
            multi_radio_pts = sum(1 for n in scanner_reach if n >= 2)

            tx = None
            if obj and obj.get("tx_power") is not None:
                try:
                    tx = int(obj["tx_power"])
                except (ValueError, TypeError):
                    pass

            label = ""
            if obj:
                label = obj.get("label") or obj.get("name") or obj.get("ble_name") or ""

            profile = {
                "device_id": did,
                "label": label,
                "model_key": _model_key(obj),
                "kind": (obj or {}).get("kind", ""),
                "cal_points": len(dev_pts),
                "scanners_total": len(scanner_rssi),
                "avg_scanner_reach": round(_mean(scanner_reach), 1),
                "multi_radio_pct": round(multi_radio_pts / len(dev_pts), 2) if dev_pts else 0,
                "avg_rssi": round(_mean(all_rssi), 1) if all_rssi else None,
                "avg_std": round(_mean(all_std), 2) if all_std else None,
                "grid_cells_hit": len(cells_hit),
                "tx_power": tx,
                "per_scanner": {
                    src: {
                        "mean_rssi": round(_mean(vals), 1),
                        "std_rssi": round(_std(vals), 2),
                        "point_count": len(vals),
                    }
                    for src, vals in scanner_rssi.items()
                },
            }
            beacons.append(profile)

        # ── Aggregate by model ──
        model_groups: dict[str, list[dict]] = {}
        for b in beacons:
            mk = b["model_key"]
            model_groups.setdefault(mk, []).append(b)

        models: dict[str, dict[str, Any]] = {}
        for mk, group in model_groups.items():
            rssi_vals = [b["avg_rssi"] for b in group if b["avg_rssi"] is not None]
            std_vals = [b["avg_std"] for b in group if b["avg_std"] is not None]
            reach_vals = [b["avg_scanner_reach"] for b in group]
            multi_vals = [b["multi_radio_pct"] for b in group]
            tx_vals = [b["tx_power"] for b in group if b["tx_power"] is not None]
            models[mk] = {
                "beacon_count": len(group),
                "total_cal_points": sum(b["cal_points"] for b in group),
                "default_avg_rssi": round(_mean(rssi_vals), 1) if rssi_vals else None,
                "default_avg_std": round(_mean(std_vals), 2) if std_vals else None,
                "default_scanner_reach": round(_mean(reach_vals), 1) if reach_vals else None,
                "default_multi_radio_pct": round(_mean(multi_vals), 2) if multi_vals else None,
                "default_tx_power": round(_mean(tx_vals)) if tx_vals else None,
                "device_ids": [b["device_id"] for b in group],
            }

        return {
            "beacons": sorted(beacons, key=lambda b: b["cal_points"], reverse=True),
            "models": models,
            "scanner_names": scanner_names,
        }
