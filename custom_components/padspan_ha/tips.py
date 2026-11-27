# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Feature tips: the backend's half of views/tips.js (2026-11-26).

A tip shows one feature this house already has (free, in its add-ons or in
Pro) and doesn't use yet: at most one a day, never before the install is a
week old, never one it has seen, a quiet card on the Overview or a line where
the Atlas is being adjusted. The panel picks and draws them; the backend only
keeps what they need, cleaned:

  tips_enabled      on by default; "No more tips" and Settings → Appearance turn it off
  tips_state        {"seen": {id: epoch s}, "dismissed": [id], "used": [id], "last_shown": epoch s}
                    (clean_state: catalogue ids only, times no later than tomorrow)
  server_tips_rank  the update check's answer (update_check._keep_tips): tip ids, the most
                    used among the opt-in reports' installs that have the feature first
                    (server/telemetry_summary.py --tips-out, merged by server/version.php).
                    Nothing is sent to get it. Only a tie-break: fit to the house comes first.

IDS is views/tips.js TIPS's ids, in its order (tests/test_tips.py holds them equal).
"""

from __future__ import annotations

import time
from typing import Any

IDS: tuple[str, ...] = (
    "house_3d", "alert_pulse", "shades", "edgecut", "room_switch", "lights_follow", "yesterday_home", "guest_tags",
    "phone_tracking", "people_3d", "atlas_overview", "audio", "alarm_arm", "door_openers", "wifi_coverage", "heatmap",
    "thermostats", "day_replay", "vacation_mode", "house_presets", "themes", "showcase", "locate", "busy_times",
    "forensics", "power_teams", "wled_controls", "light_glow", "ai_plans", "robot_vacuum",
)
_KNOWN = frozenset(IDS)
STATE_KEY = "tips_state"
RANK_KEY = "server_tips_rank"
_AHEAD_S = 86400          # a time later than this past now is a wrong clock, not a tip seen


def _ts(v: Any, now: float) -> int:
    """An epoch-seconds time as kept: a whole number, positive, not past tomorrow; 0 for anything else."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return 0
    return int(v) if 0 < v <= now + _AHEAD_S else 0


def _ids(raw: Any) -> list[str]:
    """Catalogue ids out of a list, each once, in catalogue order."""
    got = {str(x) for x in raw if isinstance(x, str)} if isinstance(raw, list) else set()
    return [i for i in IDS if i in got]


def clean_state(raw: Any, now: float | None = None) -> dict[str, Any]:
    """tips_state as kept: every key there, catalogue ids only, so it can never grow past the catalogue."""
    at = time.time() if now is None else now
    src = raw if isinstance(raw, dict) else {}
    seen_raw = src.get("seen") if isinstance(src.get("seen"), dict) else {}
    seen = {i: _ts(seen_raw.get(i), at) for i in IDS if i in seen_raw}
    seen = {i: v for i, v in seen.items() if v}
    last = _ts(src.get("last_shown"), at)
    return {"seen": seen, "dismissed": _ids(src.get("dismissed")), "used": _ids(src.get("used")),
            "last_shown": max([last, *seen.values()]) if seen or last else 0}


def clean_rank(raw: Any) -> list[str]:
    """The server's ranking as kept: catalogue ids, each once, in the server's order."""
    out: list[str] = []
    for x in raw if isinstance(raw, list) else []:
        if isinstance(x, str) and x in _KNOWN and x not in out:
            out.append(x)
    return out
