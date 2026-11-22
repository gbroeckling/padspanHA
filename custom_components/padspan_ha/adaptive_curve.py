# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
#
# The sun-position curve and the brightness and colour-temperature rules in
# this file are adapted from Adaptive Lighting by Bas Nijholt and its
# contributors (https://github.com/basnijholt/adaptive-lighting,
# custom_components/adaptive_lighting/color_and_brightness.py: SunEvents.
# sun_position, SunLightSettings._brightness_pct_default and
# .color_temp_kelvin), Copyright Bas Nijholt and contributors, licensed under
# the Apache License, Version 2.0. Changed here: plain functions over sunrise
# and sunset timestamps (no astral, no Home Assistant), colour always fades to
# the sleep colour through the night, brightness and colour only. Its
# sunrise_offset / sunset_offset and sunrise_time / sunset_time options are
# here as the same four numbers (shift_days). See THIRD_PARTY_NOTICES.md.
"""Light that follows the day: how bright and how warm a light should be now.

Pure arithmetic (no Home Assistant): power_team.py asks it for a team's
bulbs. The sun's position runs from 1 at solar noon through 0 at sunrise and
sunset to -1 at solar midnight, along a parabola between each two of those
(as Adaptive Lighting draws it). By day the colour runs from the warmest at
the horizon to the coolest at noon and the light is at its brightest; by
night the brightness falls to its lowest at midnight and the colour goes on
warming toward the sleep colour. Sleep is one fixed dim, warm setting.
"""
from __future__ import annotations

import re
from typing import Any, Callable

DEFAULTS: dict[str, Any] = {
    "min_brightness": 25,      # % at solar midnight
    "max_brightness": 100,     # % all day
    "min_kelvin": 2200,        # at sunrise and sunset
    "max_kelvin": 5000,        # at solar noon
    "sleep_brightness": 5,     # % in sleep
    "sleep_kelvin": 2000,      # in sleep, and where the night's colour heads
    # When the day starts and ends for this light (Adaptive Lighting's options of the same names): the sun's
    # sunrise and sunset moved by minutes, or a fixed time instead ("HH:MM"; "" is the sun's own). A bedroom
    # whose day starts at 06:30 all year, say.
    "sunrise_offset": 0,       # minutes, + later
    "sunset_offset": 0,
    "sunrise_time": "",
    "sunset_time": "",
    # The sun's own times held between an earliest and a latest (Adaptive Lighting's min/max_sunrise_time and
    # min/max_sunset_time): a summer dawn at 05:10 need not light a bedroom before 06:30, and a winter dusk at 16:20
    # need not dim it early. "" is no limit.
    "min_sunrise_time": "",
    "max_sunrise_time": "",
    "min_sunset_time": "",
    "max_sunset_time": "",
}
LIMITS: dict[str, tuple[int, int]] = {
    "min_brightness": (1, 100), "max_brightness": (1, 100), "sleep_brightness": (1, 100),
    "min_kelvin": (1500, 9000), "max_kelvin": (1500, 9000), "sleep_kelvin": (1500, 9000),
    "sunrise_offset": (-180, 180), "sunset_offset": (-180, 180),
}
TIMES = ("sunrise_time", "sunset_time", "min_sunrise_time", "max_sunrise_time", "min_sunset_time", "max_sunset_time")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_HALF_DAY = 43200.0


def clean(cfg: dict | None) -> dict[str, Any]:
    """The curve's numbers, each within its limits, the lows never over the highs; a time is "HH:MM" or ""."""
    out = dict(DEFAULTS)
    for k, (lo, hi) in LIMITS.items():
        v = (cfg or {}).get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = int(max(lo, min(hi, round(v))))
    for k in TIMES:
        v = (cfg or {}).get(k)
        out[k] = v if isinstance(v, str) and _HHMM.match(v) else ""
    out["min_brightness"] = min(out["min_brightness"], out["max_brightness"])
    out["min_kelvin"] = min(out["min_kelvin"], out["max_kelvin"])
    out["sleep_kelvin"] = min(out["sleep_kelvin"], out["min_kelvin"])
    return out


def shift_days(days: list[tuple[float, float]], cfg: dict | None,
               at: Callable[[int, str], float]) -> list[tuple[float, float]]:
    """Each (sunrise, sunset) as this light's day has it: a fixed time where one is set (`at(i, "HH:MM")` is that
    time on the i-th day, as a timestamp), else the sun's own moved by its offset and held between its earliest and
    latest. A day that would end before it starts is left as the sun has it."""
    c = clean(cfg)

    def held(i: int, t: float, lo: str, hi: str) -> float:
        if c[lo]:
            t = max(t, at(i, c[lo]))
        if c[hi]:
            t = min(t, at(i, c[hi]))
        return t
    out: list[tuple[float, float]] = []
    for i, (rise, set_) in enumerate(days):
        r = at(i, c["sunrise_time"]) if c["sunrise_time"] else held(i, rise + c["sunrise_offset"] * 60, "min_sunrise_time", "max_sunrise_time")
        s = at(i, c["sunset_time"]) if c["sunset_time"] else held(i, set_ + c["sunset_offset"] * 60, "min_sunset_time", "max_sunset_time")
        out.append((r, s) if r < s else (rise, set_))
    return out


def sun_events(days: list[tuple[float, float]]) -> list[tuple[str, float]]:
    """Sunrise, noon, sunset and midnight of each (sunrise, sunset) day, in order of time."""
    out: list[tuple[str, float]] = []
    for rise, set_ in days:
        noon = rise + (set_ - rise) / 2
        out += [("sunrise", rise), ("noon", noon), ("sunset", set_), ("midnight", noon + _HALF_DAY)]
    return sorted(out, key=lambda e: e[1])


def sun_position(ts: float, days: list[tuple[float, float]]) -> float:
    """The sun's position at `ts`, -1 (solar midnight) to 1 (solar noon), 0 at
    sunrise and sunset. days: (sunrise, sunset) timestamps of the day before,
    the day and the day after (more is fine); with none that span `ts`, 0."""
    ev = sun_events(days)
    nxt = next((i for i, e in enumerate(ev) if e[1] > ts), None)
    if not nxt:
        return 0.0
    (_, prev_ts), (next_name, next_ts) = ev[nxt - 1], ev[nxt]
    # The parabola's top (h) is the noon or midnight of the two, its foot (x) the sunrise or sunset.
    h, x = (prev_ts, next_ts) if next_name in ("sunset", "sunrise") else (next_ts, prev_ts)
    if h == x:
        return 0.0
    k = 1 if next_name in ("sunset", "noon") else -1
    return max(-1.0, min(1.0, k * (1 - ((ts - h) / (h - x)) ** 2)))


def settings_at(pos: float, cfg: dict | None = None, sleep: bool = False) -> dict[str, int]:
    """{"brightness_pct", "kelvin"} for the sun at `pos` (sun_position)."""
    c = clean(cfg)
    if sleep:
        return {"brightness_pct": c["sleep_brightness"], "kelvin": c["sleep_kelvin"]}
    if pos > 0:
        bri = float(c["max_brightness"])
        k = c["min_kelvin"] + (c["max_kelvin"] - c["min_kelvin"]) * pos
    else:
        bri = c["min_brightness"] + (c["max_brightness"] - c["min_brightness"]) * (1 + pos)
        k = c["sleep_kelvin"] + (c["min_kelvin"] - c["sleep_kelvin"]) * (1 + pos)
    return {"brightness_pct": int(round(bri)), "kelvin": int(5 * round(k / 5))}
