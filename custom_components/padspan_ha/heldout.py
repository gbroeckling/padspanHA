# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Held-out accuracy: how well each method does on spots it has not seen.

The Calibration score (CalibrationStore.loo_accuracy) leaves ONE point out
and keeps every other one, including the near-copies a pinned beacon records
at the same spot (up to 50 per beacon). A near-copy answers for the point
left out, so the score reads close to perfect on walked spots and says
nothing about the rest of the house. Published work shows the size of that
gap: k-NN 0.0 m median on a row split, 9.4 m with whole positions held out.

Here every calibration point within HELDOUT_RADIUS_M of the test spot (same
floor) is held out with it, and so is the rest of a beacon's own [auto]
points. Both methods are scored on the same spots:

  knn      CalibrationStore.knn_locate itself, run over the held-in points,
           so the number measures the estimator actually deployed.
  spatial  the path-loss solve (IDW centroid, WLS refinement, the same
           undetermined-fix gate), with each receiver's path-loss fit redone
           from the held-in points only. The floor is taken as known.

A spot either method could not place counts against its rooms-right share;
the median error is over the spots it did place. Nothing here writes
anything: calibration points and models are read, never changed.
"""

from __future__ import annotations

import math
from typing import Any, Callable

HELDOUT_RADIUS_M = 1.5
# Spots tested per run, at most. Each spot is a k-NN pass over every point,
# so the cost is spots x points; past this the spots are thinned evenly.
MAX_TEST_SPOTS = 300
# A method must beat the other by this much to be called better; inside the
# band the answer is "tie" and whoever is in use stays in use (hysteresis).
BETTER_ROOM_PP = 5
BETTER_MEDIAN_M = 0.5
# Fewer room-labelled test spots than this and no verdict is given.
MIN_VERDICT_SPOTS = 10


def _is_auto(p: dict[str, Any]) -> bool:
    return str(p.get("label", "")).startswith("[auto]")


def held_in(points: list[dict[str, Any]], i: int,
            radius_m: float = HELDOUT_RADIUS_M) -> list[dict[str, Any]]:
    """The points left to answer for points[i]: none within radius_m of it
    on its floor, and none of its own beacon's [auto] points."""
    t = points[i]
    tx, ty = float(t["x_m"]), float(t["y_m"])
    tf = str(t.get("floor_id") or "")
    t_dev = str(t.get("device_id") or "") if _is_auto(t) else ""
    out = []
    for j, p in enumerate(points):
        if j == i:
            continue
        if t_dev and _is_auto(p) and str(p.get("device_id") or "") == t_dev:
            continue
        if (str(p.get("floor_id") or "") == tf
                and math.hypot(float(p["x_m"]) - tx, float(p["y_m"]) - ty) <= radius_m):
            continue
        out.append(p)
    return out


class _HeldIn:
    """Just enough of a CalibrationStore for knn_locate to run over a subset."""

    def __init__(self, points: list[dict[str, Any]], excluded: frozenset[str]) -> None:
        from .calibration_store import CalibrationStore  # noqa: PLC0415
        self.data = {"points": points}
        self._excluded = excluded
        self._readings_to_map = CalibrationStore._readings_to_map

    def excluded_sources(self) -> frozenset[str]:
        return self._excluded


def _summary(errors: list[float], right: int, labelled: int, tested: int) -> dict[str, Any]:
    errors = sorted(errors)
    return {
        "spots": tested,
        "placed": len(errors),
        "room_spots": labelled,
        "rooms_right_pc": int(round(100.0 * right / labelled)) if labelled else None,
        "median_error_m": round(errors[len(errors) // 2], 2) if errors else None,
    }


class SpatialSite:
    """What the path-loss solve needs, captured once per run."""

    def __init__(self, *, positions: dict[str, tuple[float, float, str]],
                 fit_sources: set[str] | frozenset[str],
                 ref: float, n_exp: float,
                 stack_idx: dict[str, int] | None = None,
                 abs_z: dict[str, float] | None = None,
                 floor_bases: dict[str, float] | None = None,
                 dev_h: float = 1.0,
                 barriers: list[dict] | None = None,
                 max_range_m: float = 30.0) -> None:
        self.positions = positions
        self.fit_sources = set(fit_sources)
        self.ref = ref
        self.n_exp = n_exp
        self.stack_idx = stack_idx or {}
        self.abs_z = abs_z or {}
        self.floor_bases = floor_bases or {}
        self.dev_h = dev_h
        self.barriers = barriers or []
        self.max_range_m = max_range_m

    def fit_terms(self, points: list[dict[str, Any]], excluded: frozenset[str]):
        """Per receiver, each point's (log10 slant distance, rssi) — the terms
        CalibrationStore.fit_path_loss regresses — keyed by point index."""
        terms: dict[str, dict[int, tuple[float, float]]] = {}
        for src in self.fit_sources:
            pos = self.positions.get(src)
            if not pos or src in excluded:
                continue
            sz = self.abs_z.get(src)
            per: dict[int, tuple[float, float]] = {}
            for j, p in enumerate(points):
                for r in p.get("scanner_readings", []):
                    if r.get("source") != src:
                        continue
                    d_sq = (float(p["x_m"]) - pos[0]) ** 2 + (float(p["y_m"]) - pos[1]) ** 2
                    base = self.floor_bases.get(str(p.get("floor_id") or ""))
                    if sz is not None and base is not None:
                        d_sq += (sz - (base + self.dev_h)) ** 2
                    d = math.sqrt(d_sq)
                    if d < 0.3:
                        continue
                    per[j] = (math.log10(d), float(r["mean_rssi"]))
            terms[src] = per
        return terms

    @staticmethod
    def fits_without(terms, out_idx: set[int]) -> dict[str, tuple[float, float]]:
        """Path-loss fits from the held-in points, with the same sanity gate
        CalibrationStore.path_loss_by_source applies before the solve uses one."""
        fits: dict[str, tuple[float, float]] = {}
        for src, per in terms.items():
            data = [v for j, v in per.items() if j not in out_idx]
            n = len(data)
            if n < 5:
                continue
            sx = sum(d[0] for d in data)
            sy = sum(d[1] for d in data)
            sxx = sum(d[0] ** 2 for d in data)
            sxy = sum(d[0] * d[1] for d in data)
            den = n * sxx - sx ** 2
            if abs(den) < 1e-10:
                continue
            b = (n * sxy - sx * sy) / den
            a = round((sy - b * sx) / n, 1)
            n_exp = round(max(0.5, min(8.0, -b / 10.0)), 3)
            if -90.0 <= a <= -30.0 and 1.5 <= n_exp <= 4.5:
                fits[src] = (a, n_exp)
        return fits

    def locate(self, readings: dict[str, float], floor_id: str,
               fits: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
        """One-shot path-loss fix, the coordinator's Path A without smoothing."""
        from .presence_coordinator import (  # noqa: PLC0415
            _POSITION_MAX_SIGMA_M, _barrier_attenuation, _position_sigma_m,
            _range_weight, _slant_to_horizontal, _wls_refine,
        )
        slab_db = 10.0
        dev_idx = self.stack_idx.get(floor_id)
        dev_z = self.floor_bases.get(floor_id, 0.0) + self.dev_h
        every: list[tuple[str, float, float, float, float]] = []
        on_floor: list[tuple[str, float, float, float, float]] = []
        for src, rssi in readings.items():
            pos = self.positions.get(src)
            if not pos:
                continue
            if pos[2] == floor_id:
                slabs = 0
            else:
                si = self.stack_idx.get(pos[2])
                slabs = 1 if si is None or dev_idx is None else abs(si - dev_idx)
            e = (src, pos[0], pos[1], rssi - slab_db * slabs, self.abs_z.get(src, 2.4) - dev_z)
            every.append(e)
            if slabs == 0:
                on_floor.append(e)
        if len(every) < 3:
            return None
        use = on_floor if len(on_floor) >= 3 else every

        def dists(ref_pt=None):
            out = []
            for src, sx, sy, rssi, dz in use:
                att = 0.0
                if ref_pt and self.barriers:
                    att = _barrier_attenuation(sx, sy, floor_id, ref_pt[0], ref_pt[1],
                                               floor_id, self.barriers)
                ref_s, n_s = fits.get(src) or (self.ref, self.n_exp)
                d = 10.0 ** ((ref_s - (rssi + att)) / (10.0 * n_s))
                d_h = _slant_to_horizontal(d, dz)
                out.append((sx, sy, max(0.3, min(d_h, self.max_range_m)), _range_weight(d_h, d)))
            return out

        def centroid(ref_pt=None):
            wx = wy = wt = 0.0
            for sx, sy, _d, w in dists(ref_pt):
                wx += sx * w
                wy += sy * w
                wt += w
            return (wx / wt, wy / wt) if wt > 0 else None

        p1 = centroid()
        if not p1:
            return None
        ex, ey = (centroid(p1) or p1) if self.barriers else p1
        meas = dists((ex, ey) if self.barriers else None)
        rx, ry = _wls_refine(ex, ey, meas)
        if _position_sigma_m(rx, ry, meas) <= _POSITION_MAX_SIGMA_M:
            ex, ey = rx, ry
        return ex, ey


def _strongest_area(readings: dict[str, float], source_area: dict[str, str]) -> str:
    best = None
    for s, v in readings.items():
        a = source_area.get(s)
        if a and (best is None or v > best[0]):
            best = (v, a)
    return best[1] if best else ""


def evaluate(points: list[dict[str, Any]], *,
             excluded: frozenset[str] = frozenset(),
             room_at: Callable[[float, float, str], str] | None = None,
             site: SpatialSite | None = None,
             source_area: dict[str, str] | None = None,
             radius_m: float = HELDOUT_RADIUS_M) -> dict[str, Any] | None:
    """Held-out scores for k-NN and (given a site) the spatial solve."""
    from .calibration_store import KNN_K, CalibrationStore  # noqa: PLC0415
    pts = [p for p in points if p.get("x_m") is not None and p.get("y_m") is not None]
    if len(pts) < KNN_K + 1:
        return None
    # One test spot per beacon: its [auto] points are copies of one spot, and
    # scoring each of them would weigh that spot fifty times over the rest.
    seen_dev: set[str] = set()
    spots: list[int] = []
    for i, p in enumerate(pts):
        if _is_auto(p):
            dev = str(p.get("device_id") or "")
            if dev in seen_dev:
                continue
            seen_dev.add(dev)
        spots.append(i)
    step = max(1, math.ceil(len(spots) / MAX_TEST_SPOTS))
    tests = spots[::step]
    source_area = source_area or {}
    terms = site.fit_terms(pts, excluded) if site else None

    def room_of(x: float, y: float, fl: str) -> str:
        try:
            return str(room_at(x, y, fl) or "") if room_at else ""
        except Exception:
            return ""

    k_err: list[float] = []
    s_err: list[float] = []
    k_right = s_right = labelled = tested = 0
    for i in tests:
        t = pts[i]
        query = CalibrationStore._readings_to_map(t, excluded)
        if not query:
            continue
        tested += 1
        train = held_in(pts, i, radius_m)
        true_room = str(t.get("room") or "")
        fl = str(t.get("floor_id") or "")
        tx, ty = float(t["x_m"]), float(t["y_m"])
        if true_room:
            labelled += 1

        k = CalibrationStore.knn_locate(_HeldIn(train, excluded), query) if train else None
        if k and k.get("x_m") is not None:
            k_err.append(math.hypot(float(k["x_m"]) - tx, float(k["y_m"]) - ty))
            k_room = room_of(float(k["x_m"]), float(k["y_m"]), str(k.get("floor_id") or "")) \
                or str(k.get("nearest_room") or "")
            if true_room and k_room == true_room:
                k_right += 1

        if site is not None:
            train_ids = {id(p) for p in train}
            out_idx = {j for j, p in enumerate(pts) if id(p) not in train_ids}
            fits = site.fits_without(terms, out_idx)
            xy = site.locate(query, fl, fits)
            if xy:
                s_err.append(math.hypot(xy[0] - tx, xy[1] - ty))
                s_room = room_of(xy[0], xy[1], fl) or _strongest_area(query, source_area)
            else:
                s_room = ""
            if true_room and s_room == true_room:
                s_right += 1

    if not tested:
        return None
    out: dict[str, Any] = {
        "radius_m": radius_m,
        "knn": _summary(k_err, k_right, labelled, tested),
        "spatial": _summary(s_err, s_right, labelled, tested) if site is not None else None,
    }
    out["better"] = better_method(out)
    return out


def better_method(res: dict[str, Any] | None) -> str | None:
    """"knn", "spatial" or "tie" on held-out spots; None with too little to go on."""
    if not res:
        return None
    k, s = res.get("knn"), res.get("spatial")
    if not k or not s or (k.get("room_spots") or 0) < MIN_VERDICT_SPOTS:
        return None
    kr, sr = k.get("rooms_right_pc"), s.get("rooms_right_pc")
    if kr is None or sr is None:
        return None
    if kr - sr >= BETTER_ROOM_PP:
        return "knn"
    if sr - kr >= BETTER_ROOM_PP:
        return "spatial"
    km, sm = k.get("median_error_m"), s.get("median_error_m")
    if km is not None and sm is not None:
        if sm - km >= BETTER_MEDIAN_M:
            return "knn"
        if km - sm >= BETTER_MEDIAN_M:
            return "spatial"
    return "tie"


def next_preferred(current: str, res: dict[str, Any] | None) -> str:
    """The method to prefer next: a clear winner takes over; a tie or no
    verdict keeps whatever is in use, so it cannot flip on noise."""
    b = better_method(res)
    return b if b in ("knn", "spatial") else current


# ── the opt-in report: buckets only ──────────────────────────────────────────

ROOM_BUCKETS = ("lt50", "50_70", "70_85", "85_95", "ge95")
MEDIAN_BUCKETS = ("lt1", "1_2", "2_3", "3_5", "ge5")
BETTER_WORDS = ("knn", "spatial", "tie")


def room_bucket(pc: Any) -> str | None:
    if not isinstance(pc, (int, float)) or isinstance(pc, bool):
        return None
    return ("lt50" if pc < 50 else "50_70" if pc < 70 else "70_85" if pc < 85
            else "85_95" if pc < 95 else "ge95")


def median_bucket(m: Any) -> str | None:
    if not isinstance(m, (int, float)) or isinstance(m, bool):
        return None
    return "lt1" if m < 1 else "1_2" if m < 2 else "2_3" if m < 3 else "3_5" if m < 5 else "ge5"


def report_buckets(res: dict[str, Any] | None) -> dict[str, str] | None:
    """env.heldout: each method's held-out rooms-right and median error as a
    bucket word, and which one did better. None when there is nothing."""
    if not res:
        return None
    out: dict[str, str] = {}
    for word, key in (("knn", "knn"), ("sp", "spatial")):
        m = res.get(key) or {}
        rb, mb = room_bucket(m.get("rooms_right_pc")), median_bucket(m.get("median_error_m"))
        if rb:
            out[f"{word}_room"] = rb
        if mb:
            out[f"{word}_med"] = mb
    if res.get("better") in BETTER_WORDS:
        out["better"] = res["better"]
    return out or None
